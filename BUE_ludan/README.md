# 📦 EPR 录单助手 · EPR Registration Assistant

> Chrome 扩展（Manifest V3，侧边栏 Side Panel 形态）。给跨境电商「EPR 注册录单」场景的开发助手——按 **国家 × 注册地 × EPR 类型** 组合检查上传材料齐全度，AI 识别营业执照 / 身份证等关键证件，并把识别结果一键回填到对应国家 EPR 注册平台的卖家中心。

当前已支持组合：**`Italy|ChinaMainland|packaging`（意大利 EPR × 中国大陆注册 × 包装类目）**。`autofill/` 下已预置 `italy_seller_center.js`、`france_seller_center.js`、`poland_seller_center.js` 三套填表积木，加新组合的方式与姊妹项目 [`BUV_ludan`](../BUV_ludan) 一致。

---

## ✨ 核心功能

| # | 功能 | 说明 |
|---|---|---|
| 1 | **国家 × 注册地 × EPR 类型组合** | 不同组合（如 `Italy\|ChinaMainland\|packaging`）有不同的必填字段、必备文件、识别项、填表计划 |
| 2 | **拖拽文件夹上传** | 支持文件夹和单个文件，前端纯 JS 处理 |
| 3 | **AI 文档识别** | 调 Moonshot（Kimi）vision 模型识别营业执照 / 身份证正反面等证件，输出结构化 JSON |
| 4 | **PDF 多页识别** | 通过 `pdf.js` 拆页转图后逐页送 AI |
| 5 | **xlsx 模板读取** | 读"基础信息表"单元格回填字段 |
| 6 | **缺失文件兜底** | 必填项缺失时可生成临时空白占位文件（jpg/pdf/png），例如店铺后台截图占位 |
| 7 | **AI 中英互译** | 公司经营范围 / 产品名等字段支持 `xlsx_translate_to_en`，自动调 Kimi 翻译为英文 |
| 8 | **一键注入卖家中心** | 把识别 + 表格的字段按组合对应的 `autofill/<id>.js` 计划批量填到当前 EPR 平台页面 |
| 9 | **手写签名注入** | 本地用云烟体生成手写签名 → 上传 imgbb → MAIN world hook 拦截后端 signature 接口注入 URL |
| 10 | **全表清空** | 一键清掉当前页所有字段 / 上传 / 复选框，便于重测 |

---

## 🚀 安装与加载（开发者模式）

1. `git clone https://github.com/ethan-010203/ludan-BUV_BUE.git`
2. 打开 Chrome → `chrome://extensions`
3. 右上角打开「开发者模式」
4. 点「加载已解压的扩展程序」 → 选择 `ludan-BUV_BUE/BUE_ludan` 目录（即 `manifest.json` 所在目录）
5. 工具栏出现 📦 图标即装好；点击图标会在浏览器右侧打开**侧边栏（Side Panel）**

> ⚠️ 本扩展使用 Chrome MV3 的 `side_panel` 而不是传统 popup，体验上是常驻右侧面板。需要 Chrome 114+。

---

## ⚙️ 首次配置

插件依赖 Moonshot（Kimi）AI 做证件识别，**首次使用前必须配置 API Key**。

1. 点击工具栏 📦 图标打开侧边栏
2. 首次打开会自动跳到「⚙️ 配置」tab（之后随时可手动切换）
3. 前往 [platform.moonshot.cn/console/api-keys](https://platform.moonshot.cn/console/api-keys) 创建 API Key
4. 粘贴到输入框 → 点 `🧪 测试连通` 验证 → 点 `💾 保存`
5. 切回「📦 主功能」tab 即可开始使用

> 🔒 Key 仅保存在本浏览器的 `chrome.storage.local`，不会上传任何服务器。
> ❌ 未配置时主功能 tab 会显示提示 banner，所有操作按钮被禁用。

---

## 🔄 标准使用流程

```
1. 选国家 + 注册地 + EPR 类型  →  2. 拖文件夹上传  →  3. 点【🔍 开始检查】
                                                       │
                                                       ▼
                                               ┌─────────────────┐
                                               │ AI 识别 + 字段   │
                                               │ 提取 + 模块构建  │
                                               └────────┬────────┘
                                                        │
                           ┌────────────────────────────┼────────────────────────────┐
                           ▼                            ▼                            ▼
                   ┌──────────────┐           ┌──────────────┐           ┌──────────────┐
                   │ 缺失项 + 占位 │           │  ⚡ 一键注入  │           │ ✍️ 注入签名  │
                   └──────────────┘           └──────────────┘           └──────────────┘
```

---

## 📂 项目结构

```
BUE_ludan/
├── manifest.json            # MV3 清单（side_panel + permissions: storage / sidePanel / activeTab / scripting / tabs）
├── popup.html               # 侧边栏 UI（Tabs：主功能 / 配置）
├── popup.css                # 样式
├── popup.js                 # 主逻辑（~5000 行，UI / AI 调度 / 字段构建 / 签名 / 填表）
├── background.js            # service worker（侧边栏开关）
├── requirements.json        # 国家 × 注册地 × EPR 类型组合的字段配置（fields / files / placeholders / modules）
├── autofill/                # 自动填充积木（按 autofillModule ID 拆分，dynamic import）
│   ├── italy_seller_center.js    # 意大利 EPR 平台 buildPlan（当前主用）
│   ├── france_seller_center.js   # 法国 EPR 平台 buildPlan（预置）
│   └── poland_seller_center.js   # 波兰 EPR 平台 buildPlan（预置）
├── handwriting/             # 手写签名生成模块
│   ├── fonts/yunyan-data.js # ★云烟体字体（base64 内嵌，~8 MB）
│   ├── renderer.js          # 7-sigma 扰动渲染核心
│   ├── styles.js            # 签名风格预设
│   ├── index.js             # 入口（window.Handwriting）
│   └── test.html            # 独立预览页（不被插件加载）
├── libs/
│   ├── pdf.min.js           # PDF.js（PDF 拆页 → 图）
│   ├── pdf.worker.min.js    # PDF.js worker
│   ├── pdf-lib.min.js       # pdf-lib（图片→PDF 转换）
│   ├── xlsx.full.min.js     # SheetJS（读 xlsx）
│   └── postal-codes.js      # 中国邮编 / 区划数据
└── icons/                   # 16 / 48 / 128 px 图标
```

---

## 🧩 当前组合配置：`Italy|ChinaMainland|packaging`

来自 `requirements.json`：

- **必传文件**：身份证正面 / 身份证反面 / 营业执照 / 店铺后台截图 / 基础信息表（.xlsx）
- **AI 识别**：`cn_business_license` / `cn_id_card_front` / `cn_id_card_back`
- **xlsx 模板**：`basic_info_v1`
- **自动填充模块**：`italy_seller_center`
- **占位兜底**：店铺后台截图缺失时生成 `店铺后台截图_临时占位.png`
- **回填模块**：
  - 公司信息（公司中文名 / 营业执照号 / 注册地址 / 邮编 / 经营范围英文翻译）
  - 法人代表信息（身份证两面 + 姓名 / 拼音 / 身份证号 / 出生日期 / 地址 + 联系电话 / 邮箱）
  - 店铺信息（店铺链接 / 公司英文名 / 注册地址英文）
  - 产品信息（产品英文名 / 包装大类与小类，默认"纸 + 塑料"双组合）

---

## 🛠 技术栈

- **运行环境**：Chrome MV3 Extension，**Side Panel 形态**（`side_panel.default_path = popup.html`）+ `background.js` service worker
- **AI**：Moonshot vision (`kimi-k2.6` / `moonshot-v1-32k-vision-preview`)，另含 Kimi 文本模型用于中文→英文翻译
- **PDF 解析**：[PDF.js](https://mozilla.github.io/pdf.js/)
- **PDF 合成**：[pdf-lib](https://pdf-lib.js.org/)（图片证件转 PDF）
- **Excel 解析**：[SheetJS](https://sheetjs.com/)
- **图床**：[imgbb](https://imgbb.com/)（仅签名图片用）
- **手写签名**：参考 [Handright](https://github.com/Gsllchb/Handright) 的 7-sigma 扰动算法 + 云烟体内嵌字体
- **持久化**：`chrome.storage.local`（API Key、上次选择的国家/注册地/EPR 类型）

---

## 🔐 安全 & 隐私说明

- **Moonshot API Key**：用户在「⚙️ 配置」tab 自行填入，仅存本机 `chrome.storage.local`，不会上传任何服务器
- **imgbb API Key**：当前仍硬编码在 `popup.js`（开发用），如需公开发布需移到配置面板
- **AI 识别图片**：图片以 base64 形式直接 POST 给 Moonshot，不会经过插件作者服务器

---

## 🔁 与 BUV_ludan 的关系

本扩展（**BUE** = Business Unit EPR）与 [`BUV_ludan`](../BUV_ludan)（**BUV** = Business Unit VAT / 卖家中心录单）是同源姊妹项目：

| 维度 | BUE_ludan（本项目） | BUV_ludan |
|---|---|---|
| 业务场景 | **EPR 注册录单**（意大利 EPR、法国 EPR、波兰 EPR 等） | 卖家中心 / VAT 录单 |
| UI 形态 | **侧边栏 Side Panel** | popup 弹窗 |
| 当前组合 | `Italy\|ChinaMainland\|packaging` | `Poland\|China` / `France\|China` / `France\|HongKong` |
| 委托书盖章 | ❌ 不涉及 | ✅ 支持（mainland 红章 / hk 蓝章） |
| 互斥文件组 | ❌ 暂未启用 | ✅ 法人证件二选一（身份证 OR 护照） |
| 手写签名 | ✅ | ✅ |

两者共用同一套底层架构（`requirements.json` 驱动 + `autofill/<id>.js` dynamic import 积木）。需要详细的"加新组合 SOP / 字段配置结构 / AI 识别器扩展"请参考 [`BUV_ludan/ARCHITECTURE.md`](../BUV_ludan/ARCHITECTURE.md)。

---

## 📝 开发提示

- `popup.js` 是单文件大模块，所有逻辑都在 `DOMContentLoaded` 闭包内
- 加新「EPR 平台目的地」（卖家中心 DOM 不同）：在 `autofill/<id>.js` 新写一份 `buildPlan`，并在 `popup.js` 顶部 `AUTOFILL_REGISTRY` 加一行 dynamic import 即可，**不需要改 `popup.js` 主逻辑**
- 加新「国家 × 注册地 × EPR 类型」组合（平台相同）：只改 `requirements.json` 的 `countries` / `registrations` / `types` / `requirements`
- 主用 `side_panel` 而不是 `action.default_popup`，调试时要在 `chrome://extensions` 点扩展卡片的「Service Worker」入口看 `background.js` 的日志

---

## 📜 License

私有项目，仅供本团队内部使用。
