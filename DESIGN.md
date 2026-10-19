---
version: alpha
name: 杯序 · 私人咖啡馆
description: 保留私人咖啡馆的温暖，以文字、摄影和细分隔组织手机点单界面。
colors:
  primary: '#70513D'
  background: '#F7F4EE'
  ink: '#302A25'
  muted: '#73675C'
  border: '#E4DED4'
  surface: '#FFFEFB'
  selected: '#EEE6DC'
  danger: '#A54534'
typography:
  body:
    fontFamily: 'PingFang SC, Noto Sans SC, Microsoft YaHei, system-ui, sans-serif'
  brand:
    fontFamily: 'Songti SC, STSong, Georgia, serif'
  number:
    fontFamily: 'SFMono-Regular, Consolas, monospace'
rounded:
  DEFAULT: '8px'
  option: '5px'
  receipt: '6px'
  memorial: '12px'
  sheet: '20px'
spacing:
  pageGutter: '16px'
  categoryWidth: '64px'
  columnGap: '12px'
components:
  primaryButton:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.background}'
    height: '46px'
    rounded: '{rounded.DEFAULT}'
  selectedOption:
    backgroundColor: '{colors.selected}'
    textColor: '{colors.primary}'
  separator:
    backgroundColor: '{colors.border}'
  page:
    textColor: '{colors.ink}'
    backgroundColor: '{colors.background}'
  caption:
    textColor: '{colors.muted}'
  error:
    textColor: '{colors.danger}'
---

# 杯序 · 静态稿视觉规范

## Overview

面向到访私人咖啡馆的朋友与店主，简体中文、手机网页。以排版精致的咖啡菜单为参考：照片、名称与操作直接呈现。本轮名称更新为「杯序」，品牌含义为“每一杯咖啡，都是一段故事的序章。”，保留原有暖白暖棕视觉，减少普通内容的卡片化。

本规范属于 beixu-app 正式项目，沿用已确认静态稿；本项目的 API.md 与 UX-CONTRACT.md 定义真实业务。依据本轮用户批准的方案与 已确认的菜单概念图 建立；已确认的补充是登录和注册保留不超过 96px 的浅幅照片。

## Colors

复用项目暖白、咖啡棕和暖灰。`src/client/tokens.css` 是本项目的运行时色彩来源，是原有令牌的独立快照。`src/client/reference.css` 的组件通过这些变量取色，不影响原应用。主色仅用于品牌、核心按钮、文字操作、选中态和焦点；普通内容不使用大面积深色背景。

## Typography

中文正文使用系统黑体，品牌和少量英文使用宋体/衬线；编号使用等宽字体。页面标题22px、商品名16–17px、正文14px、辅助文字12–13px。菜单短描述13px；表单输入16px，保证手机阅读。颜色使用 `--ink`、`--muted`、`--primary`。

## Layout

405×720 逻辑视口以 8/3 DPR 输出1080×1920；检查360×640及430×764。页面边距16px；菜单左分类64px，列间距12px。默认商品图104×112px，窄屏88×112px；文字操作与照片共享三行网格，操作区底边与照片底边一致。

登录浅幅摄影88px；页内必需字段与主要按钮均在首屏。选配照片88px，首个选项组紧接介绍区。底部导航72px；选配固定操作区预留正文滚动空间，完整长图将其移至全部内容之后。

意式咖啡分类仅有拿铁、美式两款；列表结束后的自然留白保留，不添加跨分类饮品或填充内容。

## Elevation & Depth

普通区域无阴影、无独立容器。订单、小票、熟客卡保留一道轻量边界。弹层仅一个外层纸面，内部信息直接排版。

## Shapes

输入与照片8px、选中浅底5px、订单卡9–10px、熟客卡12px、弹层20px。没有圆角容器套圆角容器的分段切换。

## Components

主按钮46px，紧凑固定按钮至少44px；次要动作为文字。分类、Tab和选项分别通过细竖线、细下划线、单层浅底与勾选表达状态。开关有44px的操作区域。输入采用单层1px低对比描边，错误以必要的文字及边框呈现。

选配页与熟客卡的温度、奶类、拉花共用同一个分组函数和紧凑样式：左侧40px标签＋右侧选项横排，每组61px。所有选项固定64px宽、44px高，选中底色为64×28px，选中前后不改变宽高；三组占183px。共同尺寸由 `--preference-option-width`、`--preference-touch-height`、`--preference-fill-height` 定义。在405×720选配首屏中完整展示三组选项、备注与固定确认按钮。

品牌释义仅用于登录/注册、熟客实体卡和设计总览，不重复添加到功能页面标题。已确认的菜单概念图 是之前确认的历史视觉参考，当前导出画面以「杯序」为准。

所有运行页面共用 src/client/ui.tsx 的控件；朋友端和店主端接入同源 Worker API。原型总览不属于正式产品导航。

## Do's and Don'ts

- 保留照片、关键配置、真实状态和明确动作；删除重复说明。
- 商品只保留“选搭配”；不出现“一键再来”“调口味”及恢复记忆的提示。
- 卡片只承担订单、熟客纪念或信息聚合；统计、偏好、管理设置使用平铺布局。
- 以字体、对齐、间距组织信息，不以大空白、嵌套背景或装饰英文制造层次。
- 首版不接支付、配送或第三方账号；朋友使用无密码账号选择，店主独立口令。

## 正式项目的令牌与组件映射

采用既有 CSS 令牌作为运行时唯一来源（Model B），本文件镜像已确认值。tokens.css → reference.css → styles.css → ui.tsx → 朋友/店主页面。组件不得另建颜色主题。

| 设计角色                       | 运行时                                                                       | 使用者                   |
| ------------------------------ | ---------------------------------------------------------------------------- | ------------------------ |
| primary/background/ink/muted   | --primary/--bg/--ink/--muted                                                 | 全站排版、Button、Nav    |
| border/surface/selected/danger | --border/--surface/--primary-tint/--danger                                   | Field、Choices、错误提示 |
| 正文/品牌/编号字体             | --font-body/--font-display/--font-mono                                       | body、brand、mono        |
| 选项64×44，选中底64×28         | --preference-option-width/--preference-touch-height/--preference-fill-height | Choices                  |
| 控件/小票/弹层圆角             | reference.css 的组件规则                                                     | Field、receipt、Sheet    |

选项可换行，长备注和昵称可断行；正文由页面自然滚动。系统原生 select 用于低频管理表单，可接受平台拥有弹出菜单。Sheet 使用原生 dialog.showModal 管理焦点与背景 inert。手机支持 360px 起宽度，桌面居中最多480px。

有意从静态稿调整：空数据真实展示空态；页内错误与加载反馈；可编辑控件；图片来自静态摄影或 D1；安全区适配；分类排序提供可访问的上移/下移按钮。
