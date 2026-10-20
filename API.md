# 前后端接口契约

所有成功响应直接返回下列对象，失败为 `{error:{code,message,fields?}}`，HTTP 400/401/403/404/409/413/415/500。所有写请求 JSON（图片上传除外），同源校验，API no-store。

| Method / path                    | Body / query                                     | Response / rule                                                        |
| -------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------- |
| GET /api/session                 |                                                  | SessionResponse                                                        |
| POST /api/auth/login             | {identifier:string}                              | SessionResponse，朋友 cookie                                           |
| POST /api/auth/register          | {id:string,name:string}                          | SessionResponse，创建即登录，ID 0–999                                  |
| POST /api/auth/logout            |                                                  | {ok:true}，仅退出朋友                                                  |
| POST /api/owner/login            | {passphrase:string}                              | SessionResponse，独立店主 cookie                                       |
| POST /api/owner/logout           |                                                  | {ok:true}，仅退出店主                                                  |
| GET /api/menu                    |                                                  | MenuData，公开菜单，不含个人数据，包含未启用条目便于管理，前端朋友过滤 |
| GET /api/profile                 |                                                  | ProfileData，仅当前朋友                                                |
| PATCH /api/profile               | {prefs:Prefs}                                    | ProfileData                                                            |
| POST /api/favorites              | {orderId:string}                                 | ProfileData，仅自己完成订单快照，按 product+config 去重                |
| DELETE /api/favorites/:id        |                                                  | {ok:true}，限本人                                                      |
| GET /api/orders                  | ?scope=active或history&offset=0                  | OrderPage，history 每次20，active全部；仅本人                          |
| GET /api/orders/:id              |                                                  | {order:Order}，本人或店主                                              |
| GET /api/products/:id/last-order |                                                  | {order:Order                                                           | null}，当前朋友最近非取消订单 |
| POST /api/orders                 | CreateOrderRequest，Idempotency-Key header UUID  | {order:Order}，同用户同key同payload重放返回原单，不同payload 409       |
| POST /api/orders/:id/cancel      | {}                                               | {order:Order}，朋友本人queued；店主queued/making                       |
| PUT /api/orders/:id/review       | ReviewRequest                                    | {order:Order}，本人done，favorite可选                                  |
| GET /api/owner/board             |                                                  | BoardData，全部进行中+上海今日完成，counts                             |
| PATCH /api/owner/orders/:id      | {status:'making'                                 | 'done',ownerNote?:string}                                              | {order:Order}，条件更新       |
| POST /api/owner/products         | Product（id可空，服务器分配）                    | {product:Product}                                                      |
| PUT /api/owner/products/:id      | 完整Product                                      | {product:Product}                                                      |
| POST /api/owner/beans            | Bean（id可空）                                   | {bean:Bean}                                                            |
| PUT /api/owner/beans/:id         | 完整Bean                                         | {bean:Bean}                                                            |
| POST /api/owner/categories       | Category（id可空）                               | {category:Category}                                                    |
| PUT /api/owner/categories/:id    | 完整Category                                     | {category:Category}                                                    |
| PUT /api/owner/categories/order  | {ids:string[]}                                   | {ok:true}，全量id按顺序排序，必须在:id路由前注册                       |
| PATCH /api/owner/ingredients     | Record<string,boolean>，限牛奶/燕麦奶            | {ok:true}                                                              |
| PATCH /api/owner/shop            | Partial<Shop>                                    | {shop:Shop}                                                            |
| GET /api/owner/users             | ?q= ID或昵称                                     | {users:User[]}，最多20，不传q返回空                                    |
| PATCH /api/owner/users/:id       | {name:string}                                    | {user:User}                                                            |
| GET /api/owner/stats             |                                                  | OwnerStats，当日完成/当日不同用户/当日完成单评价均分，附最近20条评价   |
| POST /api/owner/media            | raw binary body + image Content-Type，最大256KiB | {url:string}，/media/:uuid                                             |
| GET /media/:id                   |                                                  | 图片二进制，公开immutable缓存，不允许SVG                               |

共享类型在 src/shared/types.ts；校验和选配恢复在 src/shared/domain.ts。生产默认无用户订单。无密码登录是产品确认的账号选择方式，不能提供用户间身份验证。

豆单：`scales` 为五个 0–5 整数，依次对应酸度、甜度、苦味、醇厚、余韵。`process`、`altitude`、`series`、`category` 为资料文本，`recommended` 为推荐饮品数组，`predicted` 表示口感是否为预测。保存时一并提交；缺省资料字段为空。
