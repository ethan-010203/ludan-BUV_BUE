// ============================================================================
// 意大利卖家中心 - 自动填充计划生成器（积木）
// ============================================================================
// 输入：modulesData（已构建好的字段值）+ foundFiles（识别到的文件）+ aiData
//       （AI 原始字段，仅作辅助）+ utils（地址拆分 / PDF 转换等通用工具）
// 输出：plan 数组，由通用引擎 pageExecutePlan 逐项执行。
//
// 与 france/poland_seller_center.js 的差异：
//   1) 文件上传容器使用 ant-upload-select-picture-card（非 .uploadClearfixBox），
//      无 field-id 属性 → 全部走 labelFallback 文本兜底定位。
//   2) 上传通道 accept=".pdf"：图片型营业执照需要先用 imageFileToPdfBlob 包成 PDF；
//      企业信用报告本身就是多页 PDF，原样上传整份文件（与 france 公司章程相同处理）。
//      法人代表身份证正反面 上传位也是 accept=".pdf"，且要求"两面合并成一份" →
//      由 buildIdCardCombinedPdf 把 id_card_front + id_card_back 合成一份 PDF
//      上传，参见下方实现注释。
//   3) 营业期限是【两个独立日期选择器 + 长期切换按钮】结构（非 range-picker，也非
//      france 那种 长期+开始日期 单 picker）：
//        - 营业期限开始日期：独立 datepicker（id=0,2,1,0,0）
//        - 营业期限结束日期：独立 datepicker（placeholder="请选择结束日期"）+ .btn_warp 长期按钮
//      因此不能用 handleBusinessTerm，按值分支：
//        - "长期" → Phase 0 PRE_CLICK 点 .btn_warp（需 labelText 限定到"营业期限结束日期"
//          所在 form-row，否则会与法人代表 身份证有效期限结束日期 的 .btn_warp 撞车），
//          结束日期 datepicker 跳过
//        - 具体日期 → 直接 datepicker，长期按钮不动
//      法人代表信息 身份证有效期限结束日期 为同样结构 + 同样 placeholder + 同样 .btn_warp
//      → 全部用 labelText 区分（详见下方 法人代表信息 部分注释）。
//   4) 三个日期 placeholder 撞车需用 elementSelector / labelText 区分：
//        - 公司成立日期：placeholder="请输入公司成立日期"（唯一） + 用 id=0,2,0,1,0
//        - 营业期限开始日期：placeholder="请选择开始日期"（与法人代表 身份证有效期限开始日期 撞车）
//          → 用 id=0,2,1,0,0 锁定
//        - 营业执照核准日期 / 企业信用报告核准日期：共享 placeholder="请输入核准日期"
//          → 用 labelText="..." 走 findInputByLabelText 作用域查找
//   5) 公司注册地址 cascader（id=0,2,6,0,0）+ 邮编（id=0,2,6,0,1）属同一 form-item "0,2,6"
//      → 邮编必须 afterPopup:true，否则 cascader 的 change 事件会清空它。
//      详细地址 textarea 在 form-item "0,2,7"，与 cascader 不同 form-item，无需 afterPopup。
//      法人代表 身份证地址 同理：cascader id=1,1,4,1,0 与 邮编 id=1,1,4,1,1 同 form-item。
//   6) 公司类型 ant-select：默认 placeholder="请选择公司类型"，AI 给出的全角括号文本
//      "有限责任公司（非自然人投资或控股的法人独资）" 与页面选项可能括号全/半角不同，
//      handleSelect 内部已做归一，能正确匹配。
//   7) "是否是最新的营业执照" 的 source 输出可能是带括号的 "否（住所不一致）"，
//      但 antd radio 文本只有 "是" / "否"。这里在送给 handleRadio 前显式裁短。
//   8) 法人代表信息：当前组合（Italy|China）只走 身份证 流（requirements.json 无护照
//      字段映射）。即便 上传法人代表证件信息 的 radio 默认是"法人身份证"，仍显式 set
//      一次以避免页面初始 radio 状态被前一组合污染。
// ============================================================================

// 清洗联系电话：剥离 +86 / 86 / 0086 国家码前缀和所有空白 / 短横 / 圆括号 / 点号，
// 让 xlsx 里写 "+86 185 8953 0850" / "+86-185-8953-0850" / "(+86) 185 8953 0850"
// 都能落到页面"18589530850"这个 11 位纯数字格式（与 france_seller_center.cleanShopPhone
// 同一逻辑；中国大陆手机号一律以 1 开头共 11 位，不会以 86 开头，剥离 86 不会误伤）。
function cleanPhoneNumber(raw) {
  if (!raw) return "";
  let s = String(raw).replace(/[\s\-().·]+/g, "");
  s = s.replace(/^(\+?0{0,2}86)/, "");
  return s;
}

export default {
  id: "italy_seller_center",

  /**
   * @param {Object} input
   * @param {Array}  input.modulesData
   * @param {Array}  input.foundFiles
   * @param {Object} input.aiData
   * @param {Object} input.utils
   * @returns {Promise<Array>} plan
   */
  async buildPlan({ modulesData, foundFiles, aiData, utils }) {
    const {
      splitAddressIntoRegionAndDetail,
      imageFileToPdfBlob,
      fileToBase64Plain,
    } = utils;

    // ---- 数据访问 helpers ----
    const moduleData = (modulesData || []).find((m) => m.title === "公司信息");
    const fields = moduleData?.fields || [];
    const get = (key) => (fields.find((f) => f.key === key)?.value || "").trim();
    const findFile = (k) => (foundFiles || []).find((f) => f.key === k);

    // ---- 文件 → 上传 payload（PDF 通道）----
    // Italy 卖家中心 营业执照 / 企业信用报告 / 法人代表身份证正反面 上传框 accept=".pdf"。
    //   - 原文件已是 PDF：原样上传，不动文件名
    //   - 原文件是图片：包成单页 PDF
    async function fileToPdfPayload(found) {
      if (!found || !(found.file && found.file.file instanceof File)) return null;
      const f = found.file.file;
      const lowerType = (f.type || "").toLowerCase();
      const lowerName = (f.name || "").toLowerCase();
      const isPdf = lowerType === "application/pdf" || lowerName.endsWith(".pdf");
      if (isPdf) {
        const base64 = await fileToBase64Plain(f);
        return { name: f.name, fileType: "application/pdf", base64, converted: false };
      }
      const { blob, name, converted } = await imageFileToPdfBlob(f);
      const base64 = await fileToBase64Plain(blob);
      return { name, fileType: "application/pdf", base64, converted };
    }

    // ---- 法人代表身份证正反面：合成单份 PDF 上传 ----
    // 意大利卖家中心 身份证正反面 上传框 accept=".pdf" 且只接受一份文件，因此正反面
    // 必须合并成一份多页 PDF。覆盖以下来源情况：
    //   A) AI 把单张图（同时含正/反两面）整体识别为"身份证正反面"——
    //      tryMatch 会把同一 file 同时塞进 id_card_front + id_card_back，path 完全一致
    //      → 直接走 fileToPdfPayload，原图包成单页 PDF（一张图够了，不用再"合并"）
    //   B) AI 在多页 PDF 上 page-by-page 识别，分别命中 正面/反面：
    //      两个 found 指向同一份 PDF File，但 path 末尾分别带 "(第N页)"
    //      → 各自抽出指定页（pdf-lib copyPages，不走 PDF→图 转换），按"前正后反"顺序
    //         拼成新 PDF
    //   C) 用户上传两份独立文件（最常见：jpg/png 各一）：
    //      → 各自 embedJpg / embedPng（失败则 fallback 走 imageFileToPdfBlob 重编码）
    //      按"前正后反"顺序拼成新 PDF
    //   D) 只有一面：仍生成单页 PDF（页面虽然要求双面，但当用户只发了一面时不阻塞填表）
    async function appendFoundToPdfDoc(outDoc, found, PDFDocument) {
      const f = found?.file?.file;
      if (!(f instanceof File)) return;
      const lowerType = (f.type || "").toLowerCase();
      const lowerName = (f.name || "").toLowerCase();
      const isPdf = lowerType === "application/pdf" || lowerName.endsWith(".pdf");
      if (isPdf) {
        const srcBytes = new Uint8Array(await f.arrayBuffer());
        const srcDoc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
        const pageMatch = (found.file.path || "").match(/\(第(\d+)页\)/);
        let indices;
        if (pageMatch) {
          const total = srcDoc.getPageCount();
          const idx = Math.max(0, Math.min(parseInt(pageMatch[1], 10) - 1, total - 1));
          indices = [idx];
        } else {
          indices = srcDoc.getPageIndices();
        }
        const pages = await outDoc.copyPages(srcDoc, indices);
        pages.forEach((p) => outDoc.addPage(p));
        return;
      }
      // 图片源：先尝试 embedJpg/embedPng（保留原编码不损失质量），失败则 fallback
      // 走 imageFileToPdfBlob（canvas 重编码为 JPEG 再包 PDF），covers webp/bmp 等。
      const bytes = new Uint8Array(await f.arrayBuffer());
      let img;
      try {
        if (lowerType === "image/png" || lowerName.endsWith(".png")) {
          img = await outDoc.embedPng(bytes);
        } else {
          img = await outDoc.embedJpg(bytes);
        }
      } catch (_) {
        const { blob } = await imageFileToPdfBlob(f);
        const wrappedBytes = new Uint8Array(await blob.arrayBuffer());
        const wrapped = await PDFDocument.load(wrappedBytes);
        const pgs = await outDoc.copyPages(wrapped, wrapped.getPageIndices());
        pgs.forEach((p) => outDoc.addPage(p));
        return;
      }
      const page = outDoc.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    }

    async function buildIdCardCombinedPdf(idFront, idBack) {
      const sources = [idFront, idBack].filter((s) => s && s.file && s.file.file instanceof File);
      if (sources.length === 0) return null;
      // Case A：同一文件同一 path（无页码后缀）→ 原样上传，一份文件就够了
      if (sources.length === 2) {
        const p1 = sources[0].file.path || "";
        const p2 = sources[1].file.path || "";
        if (p1 === p2 && !/\(第\d+页\)/.test(p1)) {
          return await fileToPdfPayload(sources[0]);
        }
      }
      // Case B/C/D：用 pdf-lib 拼装多页 PDF
      if (typeof window === "undefined" || !window.PDFLib) {
        throw new Error("pdf-lib 未加载（libs/pdf-lib.min.js）");
      }
      const { PDFDocument } = window.PDFLib;
      const outDoc = await PDFDocument.create();
      for (const s of sources) {
        await appendFoundToPdfDoc(outDoc, s, PDFDocument);
      }
      const newBytes = await outDoc.save();
      const blob = new Blob([newBytes], { type: "application/pdf" });
      const base64 = await fileToBase64Plain(blob);
      return { name: "法人身份证正反面.pdf", fileType: "application/pdf", base64, converted: true };
    }

    const businessLicense = findFile("business_license");
    const creditReport = findFile("credit_report");
    const licensePayload = await fileToPdfPayload(businessLicense);
    const creditReportPayload = await fileToPdfPayload(creditReport);

    // 法人代表身份证正反面：合成一份 PDF 上传
    const idFront = findFile("id_card_front");
    const idBack = findFile("id_card_back");
    const idCardCombinedPayload = await buildIdCardCombinedPdf(idFront, idBack);

    // ---- 公司注册地址：拆分 省/市/区 + 详细地址 ----
    const regAddrSplit = splitAddressIntoRegionAndDetail(get("公司/个体经营注册地址"));

    // ---- 是否最新营业执照：handleRadio 只匹配 "是"/"否"，裁短 source 输出 ----
    // diffLicenseVsCreditReport 返回 "是" / "否（XXX不一致）" / ""
    const licenseConsistencyRaw = get("是否是最新的营业执照");
    const licenseConsistencyShort = licenseConsistencyRaw.startsWith("是")
      ? "是"
      : licenseConsistencyRaw.startsWith("否")
        ? "否"
        : "";

    // ---- 营业期限结束日期：长期 vs 具体日期 分支 ----
    // business_term_end source：信用报告 营业期限至 为空 → "长期"，否则原日期
    const businessTermEnd = get("营业期限结束日期");
    const isBusinessTermLong = businessTermEnd === "长期";

    // ============== 法人代表信息（来自 modulesData["法人代表信息"]） ==============
    const repModule = (modulesData || []).find((m) => m.title === "法人代表信息");
    const repFields = repModule?.fields || [];
    const getRep = (key) => (repFields.find((f) => f.key === key)?.value || "").trim();

    // 当前组合（Italy|China）requirements.json 没有 idcard_or_passport 之外的护照分支字段，
    // identity 只走 身份证 流；保留 source 值（"法人身份证" / "法人护照"）原样喂给 radio。
    const identityType = getRep("上传法人代表证件信息") || "法人身份证";

    // 法人/个人代表地址：cascader(省市区) + textarea(详细)，与公司注册地址结构一致
    const repAddrSplit = splitAddressIntoRegionAndDetail(getRep("法人/个人代表地址"));

    // 拼音姓 / 拼音名：优先用 AI 直接给的两段，缺失时按"首字母大写音节"拆分
    // （仅保 1+rest 拆分，复姓识别交给 AI；与 france_seller_center 同一套兜底逻辑）。
    const aiFront = aiData?.idCardFront || {};
    const fullPinyin = (aiFront.拼音名 || "").trim();
    let surnamePinyin = (aiFront.姓拼音 || "").trim();
    let givenNamePinyin = (aiFront.名拼音 || "").trim();
    if ((!surnamePinyin || !givenNamePinyin) && fullPinyin) {
      const syllables = fullPinyin.match(/[A-Z][a-z]+/g) || [];
      if (syllables.length >= 2) {
        if (!surnamePinyin) surnamePinyin = syllables[0];
        if (!givenNamePinyin) givenNamePinyin = syllables.slice(1).join("");
      } else if (syllables.length === 1 && !surnamePinyin) {
        surnamePinyin = syllables[0];
      }
    }

    // 身份证有效期限结束日期：长期 vs 具体日期，结构与 营业期限 完全一致
    const idValidityEnd = getRep("身份证有效期限结束日期");
    const isIdValidityLong = idValidityEnd === "长期";

    // 身份证签发机关：意大利页面是单一文本框（与 france 拆 region+level 不同），
    // placeholder="请参照身份证背面输入地区名称"，只用于地区名称。从 AI 提取
    // 的"XX市公安局" / "XX区公安局" / "...公安分局" 中剥离机关后缀，仅保留行政区名。
    const issuingAuthorityRaw = getRep("身份证签发机关");
    const issuingAuthorityShort = issuingAuthorityRaw
      .replace(/公安分?局.*$/u, "")
      .replace(/[市县区]$/u, "")
      .trim();

    // ============== 店铺信息（来自 modulesData["店铺信息"]） ==============
    // requirements.json Italy|China shop fields：主要销售平台 / 店铺链接 / 销售预估 / 经营范围 /
    // 公司英文名 / 注册地址（英文）。意大利卖家中心 shop 字段比 france 少（无 店铺ID/简称/
    // 联系邮箱/未来12个月预估税金/已填写所有平台店铺信息 radio/店铺后台截图），所以这里
    // 只填 requirements.json 列出的 6 项，不要主动填其他可能存在但本组合未要求的字段。
    const shopModule = (modulesData || []).find((m) => m.title === "店铺信息");
    const shopFields = shopModule?.fields || [];
    const getShop = (key) => (shopFields.find((f) => f.key === key)?.value || "").trim();

    // ============== VAT 信息（来自 modulesData["VAT信息"]） ==============
    // 当前组合（Italy|China）只有 缴税方式 一项，default 值"季度缴税"已在 requirements.json
    // 配好；选项 ant-select 已被预设为该值 → handleSelect 用 placeholder 找不到（placeholder
    // span 已隐藏），只能用元素 id 定位。VAT select id 暂未抓出 → 用 placeholder fallback：
    // 即便已选过 placeholder span 仍在 DOM 里（display:none），handleSelect 走的是
    // .ant-select-selection__placeholder span 的 textContent 匹配，display:none 不影响命中。
    const vatModule = (modulesData || []).find((m) => m.title === "VAT信息");
    const vatFields = vatModule?.fields || [];
    const getVat = (key) => (vatFields.find((f) => f.key === key)?.value || "").trim();

    /** @type {Array<object>} */
    const plan = [
      // ============================ Phase 0 (PRE_CLICK) ============================
      // 长期切换按钮 .btn_warp：意大利页面有两处（公司信息 营业期限结束日期 + 法人代表信息
      // 身份证有效期限结束日期），DOM 顺序固定（公司信息在前，法人代表在后），用
      // pickIndex:0 / pickIndex:-1 按位置定位（labelText 对意大利页面这块不可靠，详见
      // 此前迭代记录）。
      // 点击目标：handleClick 默认就是点 hit 自身（外层 .btn_warp div），与 poland 卖家
      //   中心 handleBusinessTerm 走的同一路径 —— 实测 Vue 把 @click 绑在外层 div 而非
      //   内层 span，点 hit 才会触发 toggle。仅用单次 native el.click()，不叠加
      //   dispatchEvent(MouseEvent) 三件套（之前那么做时部分 toggle handler 把多事件算
      //   成两次激活、开-关相互抵消，看起来"已点击"但状态没变）。
      // 没有 skipIfChild* 幂等检查：.active_icon 的 SVG display 不可靠（见早期迭代记录），
      // ⚠️ afterPopup:true 把这两条挪到 Phase 4（最后一阶段）执行 —— 实测放 Phase 0 时
      //   "已点击长期"日志正常但实际表单状态没切，原因是 Phase 1 的 radio (证件类型)
      //   会触发 法人代表区段重渲染、Phase 3 的各种 popup 也可能联动重渲染，把之前点过
      //   的 长期 状态重置回未激活。挪到 Phase 4 后所有可能触发重渲染的步骤都已跑完，
      //   长期按钮的状态不会再被外力撞掉。
      //   营业期限同样挪到 Phase 4，保持两个按钮处理时序对称（公司信息区段虽不会被
      //   法人证件类型 radio 影响，但 Phase 3 的 cascader/select 仍可能联动）。
      // 一次性 plan 跑两遍会"开-关-开"切换，但实际工作流不会重复跑同一组合，可接受。
      // optional:true 保证按钮缺失时不阻断后续填表。
      ...(isBusinessTermLong
        ? [{
            type: "click",
            key: "营业期限结束日期-切换长期",
            selector: ".btn_warp",
            textContent: "长期",
            pickIndex: 0,
            afterPopup: true,
            postDelay: 250,
            optional: true,
          }]
        : []),
      ...(isIdValidityLong
        ? [{
            type: "click",
            key: "身份证有效期限结束日期-切换长期",
            selector: ".btn_warp",
            textContent: "长期",
            pickIndex: -1,
            afterPopup: true,
            postDelay: 250,
            optional: true,
          }]
        : []),

      // ============================ 公司信息 ============================
      // --- Phase 1 (PRE / radio) ---
      // 是否是最新的营业执照 — antd radio 文本就是 "是" / "否"
      { type: "radio", key: "是否是最新的营业执照", value: licenseConsistencyShort },

      // --- Phase 2 (INSTANT / text + fileById) ---
      // 文本输入 — 全部用 id 锁定避免 placeholder 撞车（含逗号 id 必须用 [id="..."]）
      { type: "text", key: "公司名称", elementSelector: '[id="0,1,0,0,0"]', placeholder: "请输入公司名称", value: get("公司名称") },
      { type: "text", key: "营业执照号码/注册号", elementSelector: '[id="0,2,0,0,0"]', placeholder: "请输入营业执照号码/注册号", value: get("营业执照号码/注册号") },
      // 注册资本：去掉末尾"元"（页面输入框只接受纯数字）。AI 已在 extractCreditReportFields
      // prompt 里完成 万 → 元 换算并输出整数字符串（如"20000"），剥离"元"后缀即可。
      { type: "text", key: "注册资本", elementSelector: '[id="0,2,6,1,0"]', placeholder: "请输入注册资本", value: get("注册资本（元）").replace(/元\s*$/u, "") },
      // 公司注册地址详细 textarea — id="0,2,7,0,1" 与 cascader（0,2,6）不同 form-item，无需 afterPopup
      { type: "text", key: "公司/个体经营注册地址-详细", elementSelector: '[id="0,2,7,0,1"]', placeholder: "请输入省/市/区后与营业执照/BR证书上一致的地址", value: regAddrSplit.detail },
      // 邮编 — id="0,2,6,0,1" 与 cascader id="0,2,6,0,0" 同 form-item "0,2,6"
      // → cascader 选完后会触发 change 事件清空同 form-item 的邮编输入；必须 afterPopup:true
      { type: "text", key: "邮编", elementSelector: '[id="0,2,6,0,1"]', placeholder: "请输入邮政编码", value: get("邮编"), afterPopup: true },
      // 签发机关 — 自由文本输入框（非下拉）
      // 页面右侧有固定文字 "市场监督管理局"（作为后缀提示自动拼上去），所以输入框只填【行政区前缀】，
      // 不带 "市场监督管理局"/"工商行政管理局"/"质量监督管理局" 等管理机关后缀。
      // 例：AI 提取 "广东省深圳市市场监督管理局" → 输入框只填 "广东省深圳市"。
      { type: "text", key: "签发机关", elementSelector: '[id="0,2,8,0,0"]', placeholder: "请输入签发机关",
        value: get("签发机关").replace(/(市场监督管理|工商行政管理|质量监督管理)局\s*$/u, "").trim() },
      // 经营范围 — textarea
      { type: "text", key: "经营范围", elementSelector: '[id="0,2,12,0,0"]', placeholder: "请输入企业信用报告上的经营范围", value: get("经营范围") },

      // 文件上传 — Italy 卖家中心使用 ant-upload-select-picture-card 容器（非 .uploadClearfixBox），
      // 无 field-id 属性，因此用 labelFallback 文本兜底。pageExecutePlan.findUploadInputByLabel
      // 会沿 DOM 向上查 input[type=file]，命中最近距离的为目标 → 不会与同名 placeholder（如
      // "营业执照号码/注册号"、"企业信用报告生成时间"）的输入框冲突。
      { type: "fileById", key: "营业执照", labelFallback: "营业执照", file: licensePayload },
      { type: "fileById", key: "企业信用报告", labelFallback: "企业信用报告", file: creditReportPayload },

      // --- Phase 3 (POPUP / datepicker + cascader + select) ---
      // 公司成立日期 — placeholder="请输入公司成立日期"（页面唯一）
      // 同时附 elementSelector 防 placeholder 飘移 / 多个空 placeholder 撞车
      { type: "datepicker", key: "公司成立日期", elementSelector: '[id="0,2,0,1,0"]', placeholder: "请输入公司成立日期", value: get("公司成立日期") },
      // 营业期限开始日期 — placeholder="请选择开始日期"
      { type: "datepicker", key: "营业期限开始日期", elementSelector: '[id="0,2,1,0,0"]', placeholder: "请选择开始日期", value: get("营业期限开始日期") },
      // 营业期限结束日期 — 仅在 非长期 时填具体日期（长期已在 Phase 0 用 .btn_warp 切换）
      ...(!isBusinessTermLong
        ? [{ type: "datepicker", key: "营业期限结束日期", placeholder: "请选择结束日期", value: businessTermEnd }]
        : []),
      // 营业执照核准日期 / 企业信用报告核准日期 — 共享 placeholder="请输入核准日期"，
      // 必须用 labelText 区分：handleDatepicker 走 findInputByLabelText 作用域查找，
      // 从 labelText 文本节点 walk-up 12 层查找 input.ant-calendar-picker-input。
      { type: "datepicker", key: "营业执照核准日期", labelText: "营业执照核准日期", value: get("营业执照核准日期") },
      { type: "datepicker", key: "企业信用报告核准日期", labelText: "企业信用报告核准日期", value: get("企业信用报告核准日期") },
      // 企业信用报告生成时间 — datetime picker（精确到秒），id="0,2,10,0,0"。
      // handleDatepicker 检测到面板含 .ant-calendar-ok-btn 时进入 datetime 分支：
      //   (1) 若时间面板未展开，先点 "选择时间"（.ant-calendar-time-picker-btn）切到 H/M/S 列
      //   (2) 各列 li 中匹配 hour/minute/second 整数文本并点击
      //   (3) 点 "确定"（.ant-calendar-ok-btn）提交，否则 blur 时 antd 会回滚未提交的选择
      // 信用报告里日期格式形如 "2026-05-19 14:48:15"（含时间），buildModuleData 会原样透传。
      { type: "datepicker", key: "企业信用报告生成时间", elementSelector: '[id="0,2,10,0,0"]', placeholder: "请对应您的企业信用报告选择精确到秒", value: get("企业信用报告生成时间") },

      // 公司类型 ant-select — placeholder="请选择公司类型"
      // AI 输出 "有限责任公司（非自然人投资或控股的法人独资）"（全角括号），页面选项也带括号；
      // handleSelect 已做半/全角括号归一 + F1 评分匹配，无需额外处理。
      { type: "select", key: "公司类型", placeholder: "请选择公司类型", value: get("公司类型") },

      // 公司注册地址 省/市/区 cascader — id="0,2,6,0,0"
      // placeholder="请选择省/市/区"（页面默认）
      { type: "cascader", key: "公司/个体经营注册地址-省市区", elementSelector: '[id="0,2,6,0,0"]', placeholder: "请选择省/市/区", value: regAddrSplit.region },

      // ============================ 法人代表信息 ============================
      // 法人国籍 ant-select（id="1,0,0,1,0"）：页面默认已选"中国"，且 ant-select 带
      // ant-select-multiple class —— handleSelect 在多选模式下再次点击同一选项会反向
      // 取消选中。本组合（Italy|China）默认值即所需值，因此不主动设置。如果将来发现
      // 默认值有丢失，再追加一条 select item（届时建议先在 handleSelect 里加"已是目标
      // 值则跳过"的幂等检查，避免反向取消）。

      // --- Phase 1 (PRE / radio) ---
      // 证件类型必须先于其他字段执行，因为切换 法人身份证 / 法人护照 会改变后续字段可见性
      // identityType 来自 idcard_or_passport source（"法人身份证" / "法人护照"）。
      // 当前组合 requirements.json 没配护照字段，identityType 实际就是 "法人身份证"，
      // 但仍显式 set 一次以避免页面初始 radio 状态被前一组合污染。
      { type: "radio", key: "证件类型", value: identityType },
      // 性别：page radio 文本就是 "男" / "女"，AI 提取的 性别 字段直接喂入即可
      { type: "radio", key: "性别", value: getRep("性别") },

      // --- Phase 2 (INSTANT / text + fileById) ---
      // 法人代表身份证正反面 — accept=".pdf"，由 buildIdCardCombinedPdf 把 id_card_front
      // + id_card_back 合成一份多页 PDF 上传（详见上方 buildIdCardCombinedPdf 注释）。
      // 容器是 ant-upload-select-picture-card（无 field-id），走 labelFallback 文本兜底。
      // --- Phase 2 (INSTANT / text + fileById) ---
      // 法人代表身份证正反面 — accept=".pdf"，由 buildIdCardCombinedPdf 把 id_card_front
      // + id_card_back 合成一份多页 PDF 上传（详见上方 buildIdCardCombinedPdf 注释）。
      // 上传容器是 .uploadClearfixBox[field-id="2008067849862955010"]（页面 HTML 抓出的固定值）；
      // 同时给 labelFallback="身份证正反面" 兜底（labelText 走 findUploadInputByLabel 文本子串匹配，
      // 用更短的核心文本而不是带前缀"法人代表..."的全名，避免被 .ant-form-item-label 文本节点拆碎）。
      {
        type: "fileById",
        key: "法人代表身份证正反面",
        fieldId: "2008067849862955010",
        labelFallback: "身份证正反面",
        file: idCardCombinedPayload,
      },
      // 文本输入 — 全部用 id 锁定避免与公司信息同名 placeholder 撞车
      { type: "text", key: "法人/个人代表中文名", elementSelector: '[id="1,1,0,0,0"]', placeholder: "请输入法人/个人代表名", value: getRep("法人/个人代表中文名") },
      // 拼音名 在 buildModuleData 里是单字段（"法人/个人代表拼音名（英文名）"），
      // 但页面拆成 姓 + 名 两个 input。surnamePinyin / givenNamePinyin 在 buildPlan
      // 顶部从 aiData.idCardFront 拆好（兜底逻辑同 france_seller_center）。
      { type: "text", key: "法人/个人代表拼音姓", elementSelector: '[id="1,1,0,1,0"]', placeholder: "姓，如Zhang", value: surnamePinyin },
      { type: "text", key: "法人/个人代表拼音名", elementSelector: '[id="1,1,0,1,1"]', placeholder: "名，如：Xingying", value: givenNamePinyin },
      // 法人代表身份证号 — id="1,1,4,0,0"
      { type: "text", key: "法人代表身份证号", elementSelector: '[id="1,1,4,0,0"]', placeholder: "请输入法人/个人代表身份证", value: getRep("法人代表身份证号") },
      // 法人/个人代表 详细地址 textarea — id="1,1,5,1,0"
      // 与 cascader id="1,1,4,1,0" 不同 form-item（"1,1,5" vs "1,1,4,1"），无需 afterPopup
      { type: "text", key: "法人/个人代表地址-详细", elementSelector: '[id="1,1,5,1,0"]', placeholder: "请输入详细地址", value: repAddrSplit.detail },
      // 法人邮编 — id="1,1,4,1,1"，与 cascader id="1,1,4,1,0" 同 form-item "1,1,4,1"
      // → cascader 选完会触发 change 事件清空同 form-item 的邮编输入；必须 afterPopup:true
      { type: "text", key: "法人邮编", elementSelector: '[id="1,1,4,1,1"]', placeholder: "请输入邮政编码", value: getRep("邮编"), afterPopup: true },
      // 身份证签发机关 — id="1,1,5,0,0"，自由文本（非下拉）
      // 页面 placeholder="请参照身份证背面输入地区名称"：只填【行政区前缀】，剥离 公安局/公安分局 后缀。
      // 例：AI 提取 "丰顺县公安局" → "丰顺"；"上海市浦东新区公安分局" → "上海市浦东新"。
      { type: "text", key: "身份证签发机关", elementSelector: '[id="1,1,5,0,0"]', placeholder: "请参照身份证背面输入地区名称", value: issuingAuthorityShort },
      // 民族 — id="1,1,7,0,0"
      { type: "text", key: "民族", elementSelector: '[id="1,1,7,0,0"]', placeholder: "请输入您的民族", value: getRep("民族") },
      // 联系邮箱 — id="1,1,8,0,0"
      { type: "text", key: "联系邮箱", elementSelector: '[id="1,1,8,0,0"]', placeholder: "请输入联系邮箱", value: getRep("联系邮箱") },
      // 联系电话 — id="1,1,8,1,1"，区号下拉（id="1,1,8,1,0"）默认 "+86 中国" 不动
      // 区号 select 与 联系电话 input 同 form-item "1,1,8,1"，但 区号 是 ant-select-multiple
      // 单值（与 法人国籍 同样的 antd 异常用法），主动 set 会触发"再点取消"风险，所以默认。
      // xlsx C12 可能写成 "+86 185-8953-0850" / "(+86) 185 8953 0850" → 清洗成 11 位纯数字
      {
        type: "text",
        key: "联系电话",
        elementSelector: '[id="1,1,8,1,1"]',
        placeholder: "请输入联系电话",
        value: cleanPhoneNumber(getRep("联系电话")),
      },

      // --- Phase 3 (POPUP / datepicker + cascader) ---
      // 身份证有效期限开始日期 — placeholder="请选择开始日期"，与公司信息 营业期限开始日期
      // 同 placeholder。营业期限开始日期 已用 elementSelector 锁定 id="0,2,1,0,0"，所以
      // 页面上 placeholder="请选择开始日期" 实质上只剩两个 input：公司信息那一个（已被
      // 上面的 datepicker 项 elementSelector 命中后并不影响 querySelectorAll 的顺序）+
      // 法人代表 这一个 → pickIndex:-1 (DOM 中最后出现的)，必然是 法人代表 行。
      // 同样 labelText 因法人代表行 label 被 Vue/antd 拆碎、textContent 被 placeholder /
      //   "开始日期"/"结束日期" 子文本搅混无法子串命中 → 全部走 pickIndex:-1 兜底。
      {
        type: "datepicker",
        key: "身份证有效期限开始日期",
        placeholder: "请选择开始日期",
        pickIndex: -1,
        value: getRep("身份证有效期限开始日期"),
      },
      // 身份证有效期限结束日期 — 仅在 非长期 时填具体日期（长期已在 Phase 0 用 .btn_warp 切换）
      // 与 营业期限结束日期 同 placeholder="请选择结束日期"，但 营业期限结束日期 长期模式下
      // 该 input 隐藏，非长期模式下 营业期限 plan 项无 elementSelector / 也走 placeholder
      // 默认查找。这里 法人代表 用 pickIndex:-1 取 DOM 最后的那个 input，正确命中。
      ...(!isIdValidityLong
        ? [
            {
              type: "datepicker",
              key: "身份证有效期限结束日期",
              placeholder: "请选择结束日期",
              pickIndex: -1,
              value: idValidityEnd,
            },
          ]
        : []),
      // 法人/个人代表出生日期 — placeholder="请选择或输入日期（20XX-XX-XX）"（页面唯一）
      {
        type: "datepicker",
        key: "法人/个人代表出生日期",
        placeholder: "请选择或输入日期（20XX-XX-XX）",
        value: getRep("法人/个人代表出生日期"),
      },

      // 法人/个人代表 省/市/区 cascader — id="1,1,4,1,0"，placeholder="请选择所在城市"
      // 页面省/市/区之后的第 4 级是镇/街道（与 公司注册地址 cascader 同样最多 4 级）。
      // splitAddressIntoRegionAndDetail 会把 AI 提取的"住址"拆成 region(省市区) + detail(剩余)。
      {
        type: "cascader",
        key: "法人/个人代表地址-省市区",
        elementSelector: '[id="1,1,4,1,0"]',
        placeholder: "请选择所在城市",
        value: repAddrSplit.region,
      },

      // ============================ 店铺信息 ============================
      // --- Phase 2 (INSTANT / text) ---
      // 主要销售平台店铺链接 — id="2,0,1,0,0"，placeholder="请输入店铺信息链接"
      {
        type: "text",
        key: "主要销售平台店铺链接",
        elementSelector: '[id="2,0,1,0,0"]',
        placeholder: "请输入店铺信息链接",
        value: getShop("主要销售平台店铺链接"),
      },
      // 未来12个月销售预估 — id="2,0,0,1,0"，placeholder="未来12个月销售预估"
      // requirements.json 字段名带"（欧元）"后缀，页面上 placeholder 不带，用 id 锁死即可
      {
        type: "text",
        key: "未来12个月销售预估",
        elementSelector: '[id="2,0,0,1,0"]',
        placeholder: "未来12个月销售预估",
        value: getShop("未来12个月销售预估（欧元）"),
      },
      // 公司英文名称 — id="2,0,3,0,0"，placeholder 是长文本（"请输入与您亚马逊后台/..."）
      {
        type: "text",
        key: "公司英文名称",
        elementSelector: '[id="2,0,3,0,0"]',
        placeholder: "请输入与您亚马逊后台",
        value: getShop("公司英文名称"),
      },
      // 公司/个体经营注册地址（英文）— id="2,0,3,1,0"，textarea，maxlength=35
      // requirements.json 字段名用全角括号，注意 getShop key 与 requirements.json 一致
      {
        type: "text",
        key: "公司/个体经营注册地址（英文）",
        elementSelector: '[id="2,0,3,1,0"]',
        placeholder: "请输入公司/个体经营注册地址（英文）",
        value: getShop("公司/个体经营注册地址（英文）"),
      },

      // --- Phase 3 (POPUP / select) ---
      // 主要销售平台 ant-select — id="2,0,0,0,0"，placeholder="请选择主要销售平台"
      // 值由 buildModuleData 的 platform_from_url 派生（亚马逊 / Temu / 速卖通 / TikTok / 其他）
      // ant-select 带 ant-select-multiple class 但 selection--single → 单值；handleSelect 已能正确处理
      {
        type: "select",
        key: "主要销售平台",
        elementSelector: '[id="2,0,0,0,0"]',
        placeholder: "请选择主要销售平台",
        value: getShop("主要销售平台"),
      },
      // 公司（个人）店铺主要经营范围 — ant-select-multiple 真正多选
      // placeholder 用半角括号 "(个人)" 与 plan key/value 全角不一致；handleSelect 内部已对
      // placeholder 查找做了括号归一，两边都能匹配。默认值 "电子商品 electrical products"。
      {
        type: "select",
        key: "公司（个人）店铺主要经营范围",
        placeholder: "请选择公司(个人)店铺主要经营范围",
        value: getShop("公司（个人）店铺主要经营范围"),
      },

      // ============================ VAT 信息 ============================
      // 缴税方式 ant-select — placeholder="请选择缴税方式"，default 值"季度缴税"
      // 已在 requirements.json 配好（注意页面文案是"季度缴税"，前期 requirements.json
      // 误写为"季度交税"，2026-05-27 修正过）。
      // 页面初始默认值已经是"季度缴税"（HTML 里 .ant-select-selection-selected-value
      // 显示 季度缴税，placeholder span style="display:none"），但仍显式 set 一次，
      // 防止页面 reset / 切换组合后丢失默认。
      {
        type: "select",
        key: "缴税方式",
        placeholder: "请选择缴税方式",
        value: getVat("缴税方式"),
      },
    ];

    return plan;
  },
};
