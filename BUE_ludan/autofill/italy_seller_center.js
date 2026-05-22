// ============================================================================
// 意大利卖家中心 - 自动填充计划生成器（积木）
// ============================================================================
// 输入：modulesData / foundFiles / aiData / utils（同 france_seller_center 的契约）
// 输出：plan 数组，由通用引擎 pageExecutePlan 逐项执行
//
// 已覆盖模块：
//   - 公司信息（id 前缀 "0,1,X,X,X"）
//   - 法人代表信息（id 前缀 "1,0,X,X,X"，证件类型默认走身份证流；含手机/邮箱）
//
// 文件上传通道：页面同时有 .h5-upload-qr-code 扫码 + 传统 input[type=file]；
// 二维码走 evatmaster sse-upload，本扩展不接入，统一用 fileById/labelFallback。
// ============================================================================

export default {
  id: "italy_seller_center",

  /**
   * @param {Object} input
   * @param {Array}  input.modulesData
   * @param {Array}  input.foundFiles
   * @param {Object} input.aiData
   * @param {Object} input.utils
   * @returns {Promise<Array>}
   */
  async buildPlan({ modulesData, foundFiles, aiData, utils }) {
    const {
      splitAddressIntoRegionAndDetail,
      fileToBase64Plain,
    } = utils;

    // ---- 数据访问 helpers ----
    const findModule = (title) => (modulesData || []).find((m) => m.title === title);
    const companyFields = (findModule("公司信息")?.fields) || [];
    const repFields = (findModule("法人代表信息")?.fields) || [];
    const shopFields = (findModule("店铺信息")?.fields) || [];
    const productFields = (findModule("产品信息")?.fields) || [];
    const getCo = (key) => (companyFields.find((f) => f.key === key)?.value || "").trim();
    const getRep = (key) => (repFields.find((f) => f.key === key)?.value || "").trim();
    const getShop = (key) => (shopFields.find((f) => f.key === key)?.value || "").trim();
    const getProd = (key) => (productFields.find((f) => f.key === key)?.value || "").trim();
    const findFile = (k) => (foundFiles || []).find((f) => f.key === k);

    // ---- 图片文件 → 上传 payload（accept=".jpg,.jpeg,.png"，keepImage:true） ----
    // 优先用 detectFiles 已经准备好的 found.imageData：
    //   - 图片源：imageData 是原图 base64
    //   - PDF 源（含正反面合一）：detectFiles 用 pdfToImages 把每页转 JPEG base64，每条
    //     found 的 imageData 是对应页的 JPEG —— 正反面 PDF 拆页是自动完成的。
    // 上传框 accept=".jpg,.png,.jpeg" 不接受 PDF，所以本函数永不返回 PDF payload。
    async function buildImagePayload(found, fieldLabel) {
      if (!found) return null;
      if (!(found.file && found.file.file instanceof File)) {
        console.warn(`[italy autofill] ${fieldLabel}: 缺少 File 对象，跳过`);
        return null;
      }
      const f = found.file.file;
      if (found.imageData) {
        const baseName = (f.name || "image").replace(/\.[^.\\/]+$/, "");
        const fileType = found.mimeType || "image/jpeg";
        const ext = fileType === "image/png" ? ".png" : ".jpg";
        return {
          name: `${baseName}${ext}`,
          fileType,
          base64: found.imageData,
          converted: false,
        };
      }
      // 兜底：imageData 不存在（理论上 detectFiles 跑过后不会发生），
      //   - 源就是图片 → 直接读 base64
      //   - 源是 PDF 但没 imageData → 报错并跳过（避免把 PDF 灌进 accept=jpg/png 上传框）
      const lowerName = (f.name || "").toLowerCase();
      const lowerType = (f.type || "").toLowerCase();
      const isImg = lowerType.startsWith("image/")
        || /\.(png|jpe?g|gif|webp|bmp)$/i.test(lowerName);
      if (!isImg) {
        console.warn(`[italy autofill] ${fieldLabel}: 源是 PDF/非图片但缺 imageData（detectFiles 未跑或失败），跳过`);
        return null;
      }
      const base64 = await fileToBase64Plain(f);
      const fileType = f.type || (lowerName.endsWith(".png") ? "image/png" : "image/jpeg");
      return { name: f.name, fileType, base64, converted: false };
    }

    // ---- 文件 payloads ----
    const licensePayload = await buildImagePayload(findFile("business_license"), "营业执照");
    const idFrontPayload = await buildImagePayload(findFile("id_card_front"), "身份证正面（人像面）");
    const idBackPayload = await buildImagePayload(findFile("id_card_back"), "身份证反面（国徽面）");
    const shopShotPayload = await buildImagePayload(findFile("shop_backend_screenshot"), "店铺后台截图");

    // ---- 公司注册地址拆分 ----
    const regAddrSplit = splitAddressIntoRegionAndDetail(getCo("公司/个体经营注册地址(中文)"));

    // ---- 法人身份证地址拆分（只用 region 灌 cascader，placeholder="请选择所在城市"） ----
    const idAddrSplit = splitAddressIntoRegionAndDetail(getRep("法人/个人代表身份证地址"));

    // ---- 拼音姓 / 拼音名拆分 ----
    // 优先用 AI 直接给的两段（aiData.idCardFront.姓拼音 / 名拼音），缺失则按
    // 首字母大写音节切分（"ZhangSan" → ["Zhang","San"]）。同 france_seller_center 的策略。
    const aiFront = aiData?.idCardFront || {};
    const fullPinyin = (aiFront.拼音名 || getRep("法人/个人代表拼音名（英文名）") || "").trim();
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

    /** @type {Array<object>} */
    const plan = [
      // ============================ 公司信息 ============================
      {
        type: "text",
        key: "公司中文名称",
        elementSelector: '[id="0,1,1,0,0"]',
        placeholder: "请输入公司中文名称",
        value: getCo("公司中文名称"),
      },
      {
        type: "text",
        key: "营业执照号码/注册号",
        elementSelector: '[id="0,1,4,1,0"]',
        placeholder: "请输入营业执照号码/注册号",
        value: getCo("营业执照号码/注册号"),
      },
      // 邮编与 cascader 同属 form-item "0,1,4,0"，cascader change 会清空 → afterPopup
      {
        type: "text",
        key: "邮编",
        elementSelector: '[id="0,1,4,0,1"]',
        placeholder: "请输入邮政编码",
        value: getCo("邮编"),
        afterPopup: true,
      },
      {
        type: "text",
        key: "公司/个体经营注册地址(中文)-详细",
        elementSelector: '[id="0,1,5,0,0"]',
        placeholder: "请输入详细地址",
        value: regAddrSplit.detail,
      },
      {
        type: "text",
        key: "公司经营范围（英文）",
        elementSelector: '[id="0,1,5,1,0"]',
        placeholder: "请输入公司经营范围（英文）",
        value: getCo("公司经营范围（英文）"),
      },
      {
        type: "fileById",
        key: "营业执照",
        labelFallback: "营业执照",
        file: licensePayload,
      },
      {
        type: "cascader",
        key: "公司/个体经营注册地址(中文)-省市区",
        elementSelector: '[id="0,1,4,0,0"]',
        placeholder: "请选择所在省/市/区",
        value: regAddrSplit.region,
      },

      // ============================ 法人代表信息 ============================
      // 证件类型 radio：点击 <span> 法人身份证 </span>。
      // 这一步必须先做，下面的字段才会挂到 DOM 上（页面会按证件类型切换字段）。
      {
        type: "radio",
        key: "证件类型",
        value: getRep("上传法人代表证件信息") || "法人身份证",
      },

      // 身份证人像面 / 国徽面 上传
      // ⚠ labelFallback 必须用页面上传框内的引导文本"（人像面）" / "（国徽面）"（全角括号），
      //    不是文档里的"身份证正面/反面" —— 页面 DOM 是 "+ 点击或拖拽上传 （人像面）"。
      // 上传框 accept=".jpg,.png,.jpeg" 只收图片：
      //   - 源是图片 → 直接用 imageData
      //   - 源是 PDF（含正反面合一 PDF）→ detectFiles 已用 pdfToImages 把每页拆成 JPEG base64
      //     存到 found.imageData，且每条 found 对应 path 末尾的 "(第N页)" —— buildImagePayload
      //     一律返回 image/jpeg 名 *.jpg 的 payload，自动满足 accept 限制。
      {
        type: "fileById",
        key: "法人代表身份证（人像面）",
        labelFallback: "（人像面）",
        file: idFrontPayload,
      },
      {
        type: "fileById",
        key: "法人代表身份证（国徽面）",
        labelFallback: "（国徽面）",
        file: idBackPayload,
      },

      // 法人中文名：id="1,0,3,0,0"，placeholder="请输入公司法人代表中文名"
      {
        type: "text",
        key: "法人/个人代表中文名",
        elementSelector: '[id="1,0,3,0,0"]',
        placeholder: "请输入公司法人代表中文名",
        value: getRep("法人/个人代表中文名"),
      },
      // 英文姓：id="1,0,3,1,0"，placeholder="姓，如：Yang"
      {
        type: "text",
        key: "法人拼音-姓",
        elementSelector: '[id="1,0,3,1,0"]',
        placeholder: "姓，如：Yang",
        value: surnamePinyin,
      },
      // 英文名：id="1,0,3,1,1"，placeholder="名，如：XingXing"
      {
        type: "text",
        key: "法人拼音-名",
        elementSelector: '[id="1,0,3,1,1"]',
        placeholder: "名，如：XingXing",
        value: givenNamePinyin,
      },

      // 法人出生日期：placeholder="请选择或输入日期（20XX-XX-XX）"
      // 页面是 ant-calendar-picker-input；datepicker handler 会打开日历面板按 value
      // (YYYY-MM-DD) 导航 + 选日期。AI 提取的出生日期已标准化为 YYYY-MM-DD。
      {
        type: "datepicker",
        key: "法人/个人代表出生日期",
        placeholder: "请选择或输入日期（20XX-XX-XX）",
        value: getRep("法人/个人代表出生日期"),
      },

      // 法人身份证号：id="1,0,5,1,0"，placeholder="请输入法人身份证号/护照号"
      {
        type: "text",
        key: "法人/个人代表身份证号",
        elementSelector: '[id="1,0,5,1,0"]',
        placeholder: "请输入法人身份证号/护照号",
        value: getRep("法人/个人代表身份证号"),
      },

      // 法人身份证地址 cascader：id="1,0,4,1,0"，placeholder="请选择所在城市"
      {
        type: "cascader",
        key: "法人/个人代表身份证地址-省市区",
        elementSelector: '[id="1,0,4,1,0"]',
        placeholder: "请选择所在城市",
        value: idAddrSplit.region,
      },

      // 固定选择 联系方式=手机号码 radio（点击 <span> 手机号码 </span>）
      {
        type: "radio",
        key: "联系方式类型",
        value: "手机号码",
      },
      // 手机号码：id="1,0,6,0,4"，placeholder="请输入法人代表手机号码"。
      // requirements.json 的 "法人联系电话" 已 stripSpaces，再保险一次去掉空白。
      {
        type: "text",
        key: "法人联系电话",
        elementSelector: '[id="1,0,6,0,4"]',
        placeholder: "请输入法人代表手机号码",
        value: getRep("法人联系电话").replace(/\s+/g, ""),
      },
      // 法人联系邮箱：id="1,0,6,1,0"，placeholder="请输入法人邮箱"
      {
        type: "text",
        key: "法人联系邮箱",
        elementSelector: '[id="1,0,6,1,0"]',
        placeholder: "请输入法人邮箱",
        value: getRep("法人联系邮箱"),
      },

      // ============================ 店铺信息 ============================
      // 店铺链接：id="2,0,0,0,0"，placeholder="请输入https://"
      {
        type: "text",
        key: "店铺链接",
        elementSelector: '[id="2,0,0,0,0"]',
        placeholder: "请输入https://",
        value: getShop("店铺链接"),
      },
      // 公司英文名称：id="2,0,0,1,0"，placeholder="请输入公司英文名称（拼音或英文）"
      {
        type: "text",
        key: "公司英文名称",
        elementSelector: '[id="2,0,0,1,0"]',
        placeholder: "请输入公司英文名称（拼音或英文）",
        value: getShop("公司英文名称"),
      },
      // 经营注册地址（英文）：id="2,0,1,0,0"，placeholder="请输入经营注册地址（英文）"
      {
        type: "text",
        key: "公司/个体经营注册地址（英文）",
        elementSelector: '[id="2,0,1,0,0"]',
        placeholder: "请输入经营注册地址（英文）",
        value: getShop("公司/个体经营注册地址（英文）"),
      },
      // 店铺后台截图上传：accept=".jpg,.jpeg,.png,.pdf"（允许 PDF，但 requirements 限定图片
      // 且 buildImagePayload 总是返回 image/jpeg payload —— 完美匹配）。
      // labelFallback 用 "店铺后台截图"：与 营业执照 同模式，依赖该文本出现在上传框附近 label。
      {
        type: "fileById",
        key: "店铺后台截图",
        labelFallback: "店铺后台截图",
        file: shopShotPayload,
      },

      // ============================ 产品信息 ============================
      // 产品英文名称：id="3,0,0,0,0"，placeholder="请输入产品英文名称"
      {
        type: "text",
        key: "产品英文名称",
        elementSelector: '[id="3,0,0,0,0"]',
        placeholder: "请输入产品英文名称",
        value: getProd("产品英文名称"),
      },

      // ============================ 包装材质表格 ============================
      // 表格结构（antd ant-table）：序号 | 大类(ant-select) | 小类(ant-select，依赖大类) | 操作
      // 业务规则：
      //   - 初始页面通常默认 1 行 → 需要点 "+ 点击新增行" 加到 2 行
      //   - 若已有 2 行 → 跳过（skipIfSelectorExists 防止 click 重复加成 3 行）
      //   - 若 >2 行 → 用户自行点删除（autofill 不主动删，避免误删用户已填内容）
      // 点击是 Phase 0（PRE_CLICK，串行），早于后面的 select；postDelay 给 Vue 时间挂上新行。
      {
        type: "click",
        key: "包装材质-新增第二行",
        selector: ".addBtn",
        textContent: "新增行",
        // 若已经有 2 行（tr:nth-child(2) 在 antd ant-table-tbody 里存在）就跳过
        skipIfSelectorExists: ".ant-table-tbody tr:nth-child(2)",
        postDelay: 400,
        optional: true,
      },

      // --- 第一行：大类=纸，小类=单一纸材料的包装 ---
      // 大类列通常是 td:nth-child(2)（td:nth-child(1) 是序号列）。
      // 小类 (td:nth-child(3)) 在大类选中前是 disabled input，选中后会被替换成新的 ant-select。
      // handleSelect 在 Phase 3 串行执行，每个 select 完成后等浮层关闭再进下一个，
      // 自然地保证小类的 ant-select 已经挂上后才去点。
      {
        type: "select",
        key: "包装材料(大类)-行1",
        elementSelector: ".ant-table-tbody tr:nth-child(1) td:nth-child(2) .ant-select",
        value: getProd("包装材料（大类）1") || "纸",
      },
      {
        type: "select",
        key: "包装材料(小类)-行1",
        elementSelector: ".ant-table-tbody tr:nth-child(1) td:nth-child(3) .ant-select",
        value: getProd("包装材料（小类）1") || "单一纸材料的包装",
      },

      // --- 第二行：大类=塑料，小类=PP/PE/PS/PET软包装 ---
      {
        type: "select",
        key: "包装材料(大类)-行2",
        elementSelector: ".ant-table-tbody tr:nth-child(2) td:nth-child(2) .ant-select",
        value: getProd("包装材料（大类）2") || "塑料",
      },
      {
        type: "select",
        key: "包装材料(小类)-行2",
        elementSelector: ".ant-table-tbody tr:nth-child(2) td:nth-child(3) .ant-select",
        value: getProd("包装材料（小类）2") || "PP/PE/PS/PET软包装",
      },
    ];

    return plan;
  }
};
