export type Status = 'queued' | 'making' | 'done' | 'cancelled';
export interface Config {
  bean: string;
  temp: string;
  milk: string;
  art: string;
  note: string;
  extra?: string;
}
export interface Prefs {
  temp: string;
  milk: string;
  art: string;
}
export interface User {
  id: number;
  name: string;
  joined: string;
  prefs: Prefs;
}
export interface Category {
  id: string;
  name: string;
  enabled: boolean;
  position: number;
}
export interface Bean {
  id: string;
  name: string;
  origin: string;
  variety: string;
  roast: string;
  tags: string[];
  /** 酸度、甜度、苦味、醇厚、余韵，依次为 0–5 分。 */
  scales: number[];
  process?: string;
  altitude?: string;
  series?: string;
  category?: string;
  recommended?: string[];
  predicted?: boolean;
  front: string;
  body: string;
  finish: string;
  note: string;
  available: boolean;
}
export interface Product {
  id: string;
  name: string;
  english: string;
  categoryId: string;
  desc: string;
  story: string;
  photo: string;
  beans: string[];
  temps: string[];
  milks: string[];
  arts: string[];
  extraLabel: string;
  extraOptions: string[];
  available: boolean;
}
export interface Shop {
  name: string;
  message: string;
  recommendedId: string;
  open: boolean;
}
export interface MenuData {
  shop: Shop;
  products: Product[];
  beans: Bean[];
  categories: Category[];
  ingredients: Record<string, boolean>;
  people: Record<string, number>;
}
export interface Review {
  stars: number;
  tags: string[];
  text: string;
  updatedAt: string;
}
export interface Snapshot {
  productName: string;
  desc: string;
  photo: string;
  beanName: string;
  config: Config;
}
export interface Order {
  id: string;
  userId: number;
  username: string;
  productId: string;
  snapshot: Snapshot;
  status: Status;
  createdAt: string;
  completedAt: string | null;
  ownerNote: string;
  review: Review | null;
}
export interface Favorite {
  id: string;
  productId: string;
  config: Config;
  productName: string;
  photo: string;
  createdAt: string;
}
export interface Stats {
  count: number;
  visits: number;
  level: string;
}
export interface ProfileData {
  user: User;
  stats: Stats;
  favorites: Favorite[];
}
export interface SessionResponse {
  user: User | null;
  owner: boolean;
}
export interface OrderPage {
  orders: Order[];
  hasMore: boolean;
}
export interface BoardData {
  orders: Order[];
  counts: Record<'queued' | 'making' | 'done', number>;
}
export interface OwnerStats {
  completed: number;
  visitors: number;
  average: number | null;
  reviews: (Review & { username: string; productName: string; orderId: string })[];
}
export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}
export interface CreateOrderRequest {
  productId: string;
  config: Config;
}
export interface ReviewRequest {
  stars: number;
  tags: string[];
  text: string;
  favorite?: boolean;
}
export const statusLabels: Record<Status, string> = {
  queued: '排队中',
  making: '制作中',
  done: '已完成',
  cancelled: '已取消',
};
export const padId = (id: number) => String(id).padStart(3, '0');
export const shanghaiDate = (at: Date | string = new Date()) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date(at));
export const dateTime = (at: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(at));
export const levelFor = (n: number) =>
  n >= 10 ? '吧台常驻' : n >= 6 ? '老位置' : n >= 3 ? '熟面孔' : n >= 1 ? '初次来坐' : '等你来坐';
export const configSummary = (c: Config, beanName = '') =>
  [beanName, c.temp, c.milk, c.art && c.art + '拉花', c.extra].filter(Boolean).join(' · ');

export const beanScaleLabels = ['酸度', '甜度', '苦味', '醇厚', '余韵'] as const;
