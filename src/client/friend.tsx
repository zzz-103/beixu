import {useEffect,useMemo,useRef,useState,type FormEvent, type ReactNode} from 'react';
import {ChevronRight,Check,Clock,Coffee,Heart,Star,X} from 'lucide-react';
import {ApiError,Link,api,json,useApp,useRemote} from './core';
import {Button,Choices,Empty,ErrorMessage,Field,focusInvalid,Loading,MemoField,Nav,Photo,Sheet,StatusLabel,TextButton,Tabs,Top} from './ui';
import {configSummary,dateTime,levelFor,padId,shanghaiDate,type Config,type Favorite,type MenuData,type Order,type OrderPage,type Product,type ProfileData,type ReviewRequest,type SessionResponse} from '../shared/types';
import {productAvailable,restoreConfig,validateConfig} from '../shared/domain';

/** Friend drafts are deliberately in-memory. They are convenient while navigating, but never persist sensitive account data. */
const drafts = new Map<string,Config>();
const draftKey = (userId:number,productId:string) => `${userId}:${productId}`;
const copyConfig = (c:Config):Config => ({bean:c.bean,temp:c.temp,milk:c.milk,art:c.art,note:c.note,extra:c.extra||''});
const uuid = () => typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const friendlyError = (error:unknown) => error instanceof Error ? error.message : '暂时无法完成，请稍后再试。';
const apiFields = (error:unknown) => error instanceof ApiError ? error.fields : {};

function AuthLayout({register,children}:{register:boolean;children:ReactNode}){
  return <section className="auth-page">
    <header className="auth-header"><Link to="/menu" className="brand" aria-label="杯序首页">杯序</Link></header>
    <figure className="auth-photo"><Photo label="一杯咖啡"/></figure>
    <div className="auth-content">
      <p className="brand-story">每一杯咖啡，都是一段故事的序章。</p>
      <h1>{register?'第一次来，认识一下。':'来啦，坐一会儿。'}</h1>
      {children}
      <div className="owner-link"><Link to="/owner/login">店主入口 <ChevronRight size={15}/></Link></div>
    </div>
  </section>;
}

function LoginPage(){
  const {refresh,navigate}=useApp();
  const [identifier,setIdentifier]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const submit=async(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault();setError('');
    if(!identifier.trim()){setError('请输入数字 ID 或昵称。');focusInvalid(e.currentTarget);return;}
    setBusy(true);
    try{await api<SessionResponse>('/api/auth/login',json({identifier:identifier.trim()}));await refresh();navigate('/menu');}
    catch(err){setError(friendlyError(err));focusInvalid(e.currentTarget);}
    finally{setBusy(false);}
  };
  return <AuthLayout register={false}>
    <form noValidate onSubmit={submit}>
      <Field label="数字 ID 或用户名" value={identifier} onChange={e=>setIdentifier(e.target.value)} placeholder="例如 007，或小林" error={error}/>
      <div className="form-link">第一次来？<Link to="/register">注册账号</Link></div>
      <Button type="submit" busy={busy}>登录</Button>
    </form>
  </AuthLayout>;
}

function RegisterPage(){
  const {refresh,navigate}=useApp();
  const [id,setId]=useState('');
  const [name,setName]=useState('');
  const [errors,setErrors]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState(false);
  const submit=async(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault();setErrors({});
    const next:Record<string,string>={};
    if(!/^\d{1,3}$/.test(id.trim())||Number(id)<0||Number(id)>999)next.id='请输入 0–999 的数字 ID。';
    if(!name.trim())next.name='请告诉我们怎么称呼你。';
    if(Object.keys(next).length){setErrors(next);focusInvalid(e.currentTarget);return;}
    setBusy(true);
    try{await api<SessionResponse>('/api/auth/register',json({id:id.trim(),name:name.trim()}));await refresh();navigate('/menu');}
    catch(err){const fields=apiFields(err);setErrors({...fields,form:Object.keys(fields).length?'':friendlyError(err)});focusInvalid(e.currentTarget);}
    finally{setBusy(false);}
  };
  return <AuthLayout register>
    <form noValidate onSubmit={submit}>
      <Field label="数字 ID" value={id} onChange={e=>setId(e.target.value.replace(/\D/g,'').slice(0,3))} placeholder="0–999，例如 008" inputMode="numeric" error={errors.id}/>
      <Field label="昵称" value={name} onChange={e=>setName(e.target.value)} placeholder="怎么称呼你" error={errors.name}/>
      {errors.form?<div className="inline-error" role="alert">{errors.form}</div>:null}
      <div className="form-link">已有账号？<Link to="/login">返回登录</Link></div>
      <Button type="submit" busy={busy}>注册账号</Button>
    </form>
  </AuthLayout>;
}

function MenuPage(){
  const {menu,session,navigate}=useApp();
  const [category,setCategory]=useState('');
  const active=useRemote<OrderPage>(session.user?'/api/orders?scope=active':null,{poll:5000});
  const categories=useMemo(()=>menu?.categories.filter(c=>c.enabled).sort((a,b)=>a.position-b.position)||[],[menu]);
  useEffect(()=>{if(!category&&categories[0])setCategory(categories[0].id);},[category,categories]);
  if(!menu)return <Loading/>;
  const products=menu.products.filter(p=>p.available&&menu.categories.some(c=>c.id===p.categoryId&&c.enabled)&&(!category||p.categoryId===category));
  const user=session.user;
  return <section className="menu-page">
    <header className="menu-header"><div className="menu-brand"><Link to="/menu" className="brand">{menu.shop.name||'杯序'}</Link><span className="open-status"><Coffee size={13}/>{menu.shop.open?'接单中':'暂停接单'}</span></div><Link to="/profile" className="avatar" aria-label="熟客卡">{user?.name?.slice(0,1)||'友'}</Link></header>
    <div className="welcome"><div className="welcome-copy"><h1>{user?.name||'朋友'}，今天喝什么？</h1><p>{menu.shop.message||'今天也有一杯，为你慢慢做。'}</p></div><Photo label="今日咖啡"/></div>
    <ErrorMessage message={active.error}/>
    {active.data?.orders?.[0]?<Link to={`/orders/${active.data.orders[0].id}`} className="active-order"><Clock size={15}/><span>你的一杯 · {active.data.orders[0].status==='making'?'制作中':'排队中'}</span><span className="right">查看进度<ChevronRight size={13}/></span></Link>:null}
    {!menu.shop.open?<p className="menu-message">小店暂停接单，已有订单继续制作。</p>:null}
    <div className="menu-layout"><nav className="categories" aria-label="饮品分类">{categories.map(c=><button type="button" key={c.id} className={c.id===category?'active':''} aria-pressed={c.id===category} onClick={()=>setCategory(c.id)}>{c.name}</button>)}</nav><div className="drink-list">{products.length?products.map(p=><DrinkRow key={p.id} product={p} available={productAvailable(p,menu)} recommended={p.id===menu.shop.recommendedId} onChoose={()=>navigate(`/customize/${encodeURIComponent(p.id)}`)}/>):<Empty title="这一类暂时没有饮品" text="换个分类看看吧。"/>}</div></div>
    <Nav active="menu"/>
  </section>;
}

function DrinkRow({product,available,recommended,onChoose}:{product:Product;available:boolean;recommended:boolean;onChoose:()=>void}){
  return <article className={`drink-row ${available?'':'sold'}`}><Photo src={product.photo} label={product.name}/><div className="drink-title"><h2>{product.name}</h2>{recommended?<small>今日推荐</small>:null}</div><p className="drink-desc">{product.desc}</p><button type="button" className="drink-action" disabled={!available} onClick={onChoose}>{available?'选搭配': '暂不可点'}{available?<ChevronRight size={14}/>:null}</button></article>;
}

function BeanSheet({bean,onClose,onPick}:{bean:NonNullable<MenuData['beans'][number]>;onClose:()=>void;onPick:()=>void}){
  return <Sheet title={bean.name} onClose={onClose}><p className="bean-origin">{bean.origin} · {bean.roast}</p><p className="flavor-tags">{bean.tags.join(' · ')}</p>{[['酸度',bean.scales[0]||0],['苦度',bean.scales[1]||0],['醇厚',bean.scales[2]||0]].map(([label,value])=><div className="bean-scale" key={String(label)}><span>{label}</span><div className="scale-track">{[1,2,3,4,5].map(i=><i key={i} className={i<=Number(value)?'filled':''}/>)}</div></div>)}<div className="bean-taste"><p>前段 · {bean.front}</p><p>中段 · {bean.body}</p><p>尾韵 · {bean.finish}</p><p className="caption">{bean.note}</p></div><Button onClick={onPick}>选用这款豆</Button></Sheet>;
}

function ConfirmSheet({product,config,beanName,onClose,onConfirm,busy,error}:{product:Product;config:Config;beanName:string;onClose:()=>void;onConfirm:()=>void;busy:boolean;error:string}){
  return <Sheet title="确认这杯" onClose={onClose}><div className="product-intro"><Photo src={product.photo} label={product.name}/><div><h1>{product.name}</h1><p>{product.desc}</p></div></div><dl className="details"><div><dt>咖啡豆</dt><dd>{beanName||'无'}</dd></div><div><dt>温度 / 奶类</dt><dd>{[config.temp,config.milk].filter(Boolean).join(' / ')||'按饮品默认'}</dd></div><div><dt>拉花</dt><dd>{config.art||'不指定'}</dd></div>{config.extra?<div><dt>{product.extraLabel||'附加选项'}</dt><dd>{config.extra}</dd></div>:null}<div><dt>备注</dt><dd>{config.note||'无'}</dd></div></dl><p className="caption">下单后加入制作队列。</p><ErrorMessage message={error}/><Button onClick={onConfirm} busy={busy}>确认点单</Button><div style={{display:'flex',justifyContent:'center'}}><TextButton onClick={onClose}>返回修改</TextButton></div></Sheet>;
}

function CustomizePage({productId}:{productId:string}){
  const {menu,session,navigate,refresh}=useApp();
  const product=menu?.products.find(p=>p.id===productId);
  const [config,setConfig]=useState<Config>(()=>product&&menu&&session.user?copyConfig(drafts.get(draftKey(session.user.id,product.id))||restoreConfig(product,menu,session.user.prefs).config):{bean:'',temp:'',milk:'',art:'',note:'',extra:''});
  const [changes,setChanges]=useState<string[]>([]);
  const [beanSheet,setBeanSheet]=useState<string|null>(null);
  const [confirm,setConfirm]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const last=useRemote<{order:Order}|null>(product&&session.user?`/api/products/${encodeURIComponent(product.id)}/last-order`:null);
  const initialized=useRef(false);
  const keyRef=useRef(uuid());
  const payloadRef=useRef('');
  useEffect(()=>{
    if(!product||!menu||!session.user||initialized.current)return;
    if(last.loading)return;
    const key=draftKey(session.user.id,product.id);const saved=drafts.get(key);
    const restored=restoreConfig(product,menu,saved||last.data?.order?.snapshot.config,session.user.prefs);
    setConfig(copyConfig(restored.config));setChanges(restored.changes);drafts.set(key,copyConfig(restored.config));initialized.current=true;
  },[product,menu,session.user,last.loading,last.data]);
  if(!menu||!session.user)return <Loading/>;
  if(!product)return <section className="content"><Top title="选搭配"/><Empty title="找不到这杯" text="回到菜单选一杯喜欢的吧。"><Link to="/menu" className="text-action">回到菜单<ChevronRight size={15}/></Link></Empty></section>;
  const beans=product.beans.map(id=>menu.beans.find(b=>b.id===id)).filter((b):b is NonNullable<typeof b>=>!!b);
  const selectedBean=beans.find(b=>b.id===config.bean);
  const update=(patch:Partial<Config>)=>setConfig(prev=>{const next={...prev,...patch};if('temp' in patch||'milk' in patch){if(next.temp==='热'&&next.milk==='牛奶'&&product.arts.length&&!next.art)next.art=product.arts[0];else if(!(next.temp==='热'&&next.milk==='牛奶'))next.art='';}drafts.set(draftKey(session.user!.id,product!.id),copyConfig(next));return next;});
  const beginConfirm=()=>{setError('');const validation=validateConfig(product,config,menu);if(validation){setError(validation);return;}setConfirm(true);};
  const confirmOrder=async()=>{
    setError('');setBusy(true);
    const payload={productId:product.id,config:copyConfig(config)};const serialized=JSON.stringify(payload);if(serialized!==payloadRef.current){payloadRef.current=serialized;keyRef.current=uuid();}
    try{const result=await api<{order:Order}>('/api/orders',{...json(payload),headers:{'Idempotency-Key':keyRef.current}});drafts.delete(draftKey(session.user!.id,product.id));setConfirm(false);await refresh();navigate(`/orders/${result.order.id}`);}
    catch(err){setError(friendlyError(err));}
    finally{setBusy(false);}
  };
  return <section className="custom-screen"><Top title="选搭配"/><section className="content custom-content"><div className="product-intro"><Photo src={product.photo} label={product.name}/><div><h1>{product.name}</h1><p>{product.desc}</p><small>{product.english}</small></div></div>{changes.map(change=><p className="fallback" key={change}>{change}</p>)}<div className="option-group" role="group" aria-label="咖啡豆"><h2 className="choice-label">咖啡豆</h2><div className="bean-options">{beans.length?beans.map(bean=><div className={`bean-option ${bean.id===config.bean?'selected':''}`} key={bean.id}><button type="button" className="bean-option" onClick={()=>update({bean:bean.id})}><span className="radio"/><span><span className="name">{bean.name}{!bean.available?<span className="tag muted"> · 暂缺</span>:null}</span><span className="caption">{bean.tags.join(' · ')}</span></span></button><TextButton onClick={()=>setBeanSheet(bean.id)}>风味 <ChevronRight size={13}/></TextButton></div>):<p className="caption">这杯暂不需要咖啡豆。</p>}</div></div>{product.temps.length?<Choices label="温度" options={product.temps} value={config.temp} onChange={(value:string)=>update({temp:value})}/>:null}{product.milks.length?<Choices label="奶类" options={product.milks.filter(m=>menu.ingredients[m])} value={config.milk} onChange={(value:string)=>update({milk:value})}/>:null}{product.arts.length&&config.temp==='热'&&config.milk==='牛奶'?<Choices label="拉花" options={product.arts} value={config.art} onChange={(value:string)=>update({art:value})}/>:null}{product.extraOptions.length?<Choices label={product.extraLabel||'附加选项'} options={product.extraOptions} value={config.extra||''} onChange={(value:string)=>update({extra:value})}/>:null}<Field label="备注（选填）" value={config.note} onChange={e=>update({note:e.target.value})} placeholder="还有什么想告诉店主？"/><ErrorMessage message={error}/></section><div className="sticky-action custom-footer"><p className="summary">{configSummary(config,selectedBean?.name)}</p><Button onClick={beginConfirm}>确认这杯</Button></div>{beanSheet?<BeanSheet bean={menu.beans.find(b=>b.id===beanSheet)!} onClose={()=>setBeanSheet(null)} onPick={()=>{update({bean:beanSheet});setBeanSheet(null)}}/>:null}{confirm?<ConfirmSheet product={product} config={config} beanName={selectedBean?.name||''} onClose={()=>setConfirm(false)} onConfirm={confirmOrder} busy={busy} error={error}/>:null}</section>;
}

function OrderCard({order,onOpen}:{order:Order;onOpen:()=>void}){
  return <><button type="button" className="order-card" onClick={onOpen}><div className="order-meta"><span>{dateTime(order.createdAt)}</span><StatusLabel status={order.status}/></div><div className="order-product"><Photo src={order.snapshot.photo} label={order.snapshot.productName}/><div><h2>{order.snapshot.productName}</h2><p>{configSummary(order.snapshot.config,order.snapshot.beanName)}</p>{order.snapshot.config.note?<p>{order.snapshot.config.note}</p>:null}</div><ChevronRight className="chevron"/></div></button>{order.status==='done'&&!order.review?<div className="review-link"><TextButton onClick={onOpen}>评价这杯 <ChevronRight size={14}/></TextButton></div>:null}</>;
}

function OrdersPage(){
  const {navigate}=useApp();
  const [tab,setTab]=useState<'active'|'history'>('active');
  const [offset,setOffset]=useState(0);const [historyOrders,setHistoryOrders]=useState<Order[]>([]);const lastOffset=useRef(-1);
  const remote=useRemote<OrderPage>(`/api/orders?scope=${tab}&offset=${offset}`,{poll:tab==='active'?5000:0});
  useEffect(()=>{if(tab==='history'&&remote.data&&lastOffset.current!==offset){lastOffset.current=offset;setHistoryOrders(prev=>offset? [...prev,...remote.data!.orders]:remote.data!.orders);}},[tab,offset,remote.data]);
  useEffect(()=>{setOffset(0);setHistoryOrders([]);lastOffset.current=-1;},[tab]);
  const orders=tab==='active'?remote.data?.orders||[]:historyOrders;const hasMore=tab==='history'&&(offset===0?remote.data?.hasMore:remote.data?.hasMore);
  return <section><Top title="我的订单"/><section className="content"><h1 className="page-heading">我的订单</h1><Tabs items={[`进行中 ${tab==='active'&&orders.length?` ${orders.length}`:' 0'}`,'喝过的']} value={tab==='active'?`进行中 ${tab==='active'&&orders.length?` ${orders.length}`:' 0'}`:'喝过的'} onChange={value=>setTab(value==='喝过的'?'history':'active')}/><ErrorMessage message={remote.error} onRetry={remote.reload}/>{remote.loading&&!remote.data?<Loading/>:orders.length?orders.map(order=><OrderCard key={order.id} order={order} onOpen={()=>navigate(`/orders/${order.id}`)}/>):<Empty title={tab==='active'?'还没有进行中的订单':'还没有喝过的记录'} text={tab==='active'?'选一杯喜欢的，店主慢慢为你做。':'喝完第一杯，这里会留下你的咖啡记忆。'}>{tab==='active'?<Link to="/menu" className="text-action">去点一杯 <ChevronRight size={14}/></Link>:null}</Empty>}{tab==='history'&&hasMore?<Button onClick={()=>setOffset(v=>v+20)} busy={remote.loading}>加载更多</Button>:null}</section><Nav active="orders"/></section>;
}

function ReviewSheet({order,onClose,onSaved}:{order:Order;onClose:()=>void;onSaved:(order:Order)=>void}){
  const [stars,setStars]=useState(order.review?.stars||0);const [tags,setTags]=useState<string[]>(order.review?.tags||[]);const [text,setText]=useState(order.review?.text||'');const [favorite,setFavorite]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const options=['奶香刚好','很顺滑','还想再喝','有点浓'];
  const submit=async()=>{if(!stars){setError('请先点亮星星。');return;}setBusy(true);setError('');const body:ReviewRequest={stars,tags,text};if(favorite)body.favorite=true;try{const result=await api<{order:Order}>(`/api/orders/${order.id}/review`,json(body,'PUT'));onSaved(result.order);onClose();}catch(err){setError(friendlyError(err));}finally{setBusy(false);}};
  return <Sheet title="这杯喝得怎么样？" onClose={onClose}><div className="product-intro"><Photo src={order.snapshot.photo} label={order.snapshot.productName}/><div><h1>{order.snapshot.productName}</h1><p>{configSummary(order.snapshot.config,order.snapshot.beanName)}</p></div></div><div className="review-stars" aria-label="评分">{[1,2,3,4,5].map(value=><button type="button" key={value} className={value<=stars?'selected':''} aria-label={`${value} 星`} onClick={()=>setStars(value)}><Star/></button>)}</div><div className="review-tags">{options.map(tag=>{const selected=tags.includes(tag);return <button type="button" className={`option ${selected?'selected':''}`} key={tag} aria-pressed={selected} onClick={()=>setTags(selected?tags.filter(item=>item!==tag):[...tags,tag])}>{tag}{selected?<Check size={12}/>:null}</button>;})}</div><MemoField label="给店主留句话（选填）" value={text} onChange={setText}/><button type="button" className="check-row" aria-pressed={favorite} onClick={()=>setFavorite(v=>!v)}><span className={`check-square ${favorite?'':'muted'}`}>{favorite?<Check size={11}/>:null}</span>收藏这个搭配</button><ErrorMessage message={error}/><Button onClick={submit} busy={busy}>提交评价</Button></Sheet>;
}

function OrderDetailPage({orderId}:{orderId:string}){
  const {navigate,refresh}=useApp();
  const remote=useRemote<{order:Order}>(`/api/orders/${encodeURIComponent(orderId)}`,{poll:5000});
  const [cancelConfirm,setCancelConfirm]=useState(false);const [cancelBusy,setCancelBusy]=useState(false);const [error,setError]=useState('');const [review,setReview]=useState(false);
  if(remote.loading&&!remote.data)return <><Top title="订单详情"/><Loading/></>;
  const order=remote.data?.order;
  if(!order)return <><Top title="订单详情"/><section className="content"><ErrorMessage message={remote.error||'找不到这笔订单。'} onRetry={remote.reload}/></section></>;
  const done=order.status==='done';const cancelled=order.status==='cancelled';
  const cancel=async()=>{setCancelBusy(true);setError('');try{const result=await api<{order:Order}>(`/api/orders/${order.id}/cancel`,json({}));remote.reload();await refresh();setCancelConfirm(false);if(result.order.status==='cancelled')navigate(`/orders/${order.id}`);}catch(err){setError(friendlyError(err));}finally{setCancelBusy(false);}};
  return <section><Top title="订单详情"/><section className="content"><ErrorMessage message={remote.error||error} onRetry={remote.reload}/><div className="order-detail-heading"><h1>{cancelled?'这杯已取消':done?'这杯已完成':'这杯正在排队'}</h1><span className="caption mono">NO. {order.id.slice(-4).toUpperCase()}</span></div><div className="steps"><span className="step active">已下单</span><i/><span className={`step ${order.status==='making'||done?'active':''}`}>制作中</span><i/><span className={`step ${done?'active':''}`}>已完成</span></div><article className="receipt"><div className="receipt-head"><div className="brand">杯序</div><span>{order.username} · NO. {padId(order.userId)}</span></div><div className="order-product"><Photo src={order.snapshot.photo} label={order.snapshot.productName}/><div><h2>{order.snapshot.productName}</h2><p>{order.snapshot.desc}</p></div></div><dl className="details"><div><dt>咖啡豆</dt><dd>{order.snapshot.beanName||'无'}</dd></div><div><dt>温度 / 奶类</dt><dd>{[order.snapshot.config.temp,order.snapshot.config.milk].filter(Boolean).join(' / ')||'默认'}</dd></div><div><dt>拉花</dt><dd>{order.snapshot.config.art||'不指定'}</dd></div>{order.snapshot.config.extra?<div><dt>附加选项</dt><dd>{order.snapshot.config.extra}</dd></div>:null}<div><dt>备注</dt><dd>{order.snapshot.config.note||'无'}</dd></div></dl><p className="time">{dateTime(order.createdAt)} 下单{order.completedAt?<><br/>{dateTime(order.completedAt)} 完成</>:null}</p></article>{order.ownerNote?<div className="owner-note"><h2>店主的小纸条</h2><p>{order.ownerNote}</p></div>:null}{done?<><div style={{marginTop:16}}><Button onClick={()=>setReview(true)}>{order.review?'修改评价':'评价这杯'}</Button></div><div className="detail-actions"><TextButton onClick={async()=>{try{await api('/api/favorites',json({orderId:order.id}));await refresh();}catch(err){setError(friendlyError(err));}}}>收藏搭配</TextButton><TextButton onClick={()=>{navigate(`/customize/${encodeURIComponent(order.productId)}`);}}>再点一杯</TextButton></div></>:order.status==='queued'?<>{cancelConfirm?<div className="cancel-confirm"><p>确定取消这杯吗？</p><div className="row"><TextButton onClick={()=>setCancelConfirm(false)}>先留着</TextButton><TextButton className="danger" onClick={cancel} disabled={cancelBusy}>{cancelBusy?'正在取消…':'确认取消'}</TextButton></div></div>:<div className="detail-actions"><TextButton onClick={()=>setCancelConfirm(true)}>取消订单</TextButton></div>}</>:<p className="caption">前面还有几杯，做好了会告诉你。</p>}{review?<ReviewSheet order={order} onClose={()=>setReview(false)} onSaved={updated=>{remote.reload();void refresh();}}/>:null}</section></section>;
}

function ProfilePage(){
  const {navigate,refresh}=useApp();
  const remote=useRemote<ProfileData>('/api/profile');
  const [prefs,setPrefs]=useState({temp:'',milk:'',art:''});const [saveBusy,setSaveBusy]=useState(false);const [error,setError]=useState('');
  useEffect(()=>{if(remote.data)setPrefs({...remote.data.user.prefs});},[remote.data]);
  if(remote.loading&&!remote.data)return <><Top title="我的熟客卡"/><Loading/></>;
  const profile=remote.data;
  if(!profile)return <><Top title="我的熟客卡"/><section className="content"><ErrorMessage message={remote.error} onRetry={remote.reload}/></section></>;
  const save=async()=>{setSaveBusy(true);setError('');try{await api<ProfileData>('/api/profile',json({prefs},'PATCH'));await remote.reload();}catch(err){setError(friendlyError(err));}finally{setSaveBusy(false);}};
  const removeFavorite=async(favorite:Favorite)=>{try{await api(`/api/favorites/${encodeURIComponent(favorite.id)}`,{method:'DELETE'});await remote.reload();}catch(err){setError(friendlyError(err));}};
  const chooseFavorite=(favorite:Favorite)=>{drafts.set(draftKey(profile.user.id,favorite.productId),copyConfig(favorite.config));navigate(`/customize/${encodeURIComponent(favorite.productId)}`);};
  const logout=async()=>{try{await api('/api/auth/logout',json({}));await refresh();navigate('/login');}catch(err){setError(friendlyError(err));}};
  return <section><Top title="我的熟客卡"/><section className="content profile-content"><ErrorMessage message={error||remote.error} onRetry={remote.reload}/><h1 className="page-heading">我的熟客卡</h1><article className="regular-card"><div className="card-brand">{profile.user.name||'杯序'}</div><p className="card-subtitle">每一杯咖啡，都是一段故事的序章。</p><span className="stamp">{levelFor(profile.stats.count)}</span><p className="card-id">NO. {padId(profile.user.id)}</p><p className="card-name">{profile.user.name}的老位置</p><p className="card-date">第一次来 · {shanghaiDate(profile.user.joined).replaceAll('-','.')}</p></article><div className="stats"><div><strong>{profile.stats.count}</strong><small>喝过的杯数</small></div><div><strong>{profile.stats.visits}</strong><small>来坐过的天数</small></div><div><strong>{profile.favorites.length}</strong><small>喜欢的搭配</small></div></div><h2 className="section-title">我的偏好</h2><Choices label="温度" options={['热','冰']} value={prefs.temp} onChange={(value:string)=>setPrefs(v=>({...v,temp:value}))}/><Choices label="奶类" options={['牛奶','燕麦奶']} value={prefs.milk} onChange={(value:string)=>setPrefs(v=>({...v,milk:value}))}/><Choices label="拉花" options={['不指定','爱心','树叶']} value={prefs.art||'不指定'} onChange={(value:string)=>setPrefs(v=>({...v,art:value==='不指定'?'':value}))}/><div className="row"><Button onClick={save} busy={saveBusy}>保存偏好</Button></div><h2 className="section-title">喜欢的搭配</h2>{profile.favorites.length?profile.favorites.map(favorite=><div className="favorite" key={favorite.id}><Photo src={favorite.photo} label={favorite.productName}/><div><h3>{favorite.productName}</h3><p>{configSummary(favorite.config)}</p></div><TextButton onClick={()=>chooseFavorite(favorite)}>选搭配 <ChevronRight size={14}/></TextButton><TextButton onClick={()=>removeFavorite(favorite)} aria-label={`取消收藏 ${favorite.productName}`}>取消收藏</TextButton></div>):<p className="caption">完成一杯评价后，可以把喜欢的搭配留在这里。</p>}<div className="setting-row"><Link to="/orders">我的订单</Link><ChevronRight size={16}/></div><div className="account-links"><button type="button" className="text-action" onClick={logout}>退出账号</button><Link to="/owner/login">店主入口</Link></div></section><Nav active="profile"/></section>;
}

export function FriendRoutes(){
  const {path,session,navigate,loading}=useApp();
  const isAuth=path==='/login'||path==='/register';
  useEffect(()=>{if(loading)return;if(session.user&&isAuth)navigate('/menu');if(!session.user&&!isAuth)navigate('/login');},[loading,session.user,isAuth,navigate]);
  if(loading)return <Loading/>;
  if((!session.user&&!isAuth)||(session.user&&isAuth))return <Loading/>;
  if(path==='/login')return <LoginPage/>;
  if(path==='/register')return <RegisterPage/>;
  if(path==='/'||path==='/menu')return <MenuPage/>;
  if(path==='/orders')return <OrdersPage/>;
  const detailMatch=path.match(/^\/orders\/([^/]+)$/);if(detailMatch)return <OrderDetailPage orderId={decodeURIComponent(detailMatch[1])}/>;
  const customizeMatch=path.match(/^\/customize\/([^/]+)$/);if(customizeMatch)return <CustomizePage productId={decodeURIComponent(customizeMatch[1])}/>;
  if(path==='/profile')return <ProfilePage/>;
  return <MenuPage/>;
}

export default FriendRoutes;

