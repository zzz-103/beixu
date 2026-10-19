import type { Config, Product, MenuData, Prefs } from './types';
export const blankConfig: Config = { bean: '', temp: '', milk: '', art: '', note: '', extra: '' };
export function productAvailable(p: Product, m: MenuData): boolean {
  return (
    p.available &&
    !!m.categories.find((c) => c.id === p.categoryId && c.enabled) &&
    (!p.beans.length || p.beans.some((id) => m.beans.some((b) => b.id === id && b.available))) &&
    (!p.milks.length || p.milks.some((s) => m.ingredients[s]))
  );
}
export function validateConfig(p: Product, c: Config, m: MenuData): string {
  if (!m.shop.open) return '小店暂停接单，已有订单继续制作。';
  if (!productAvailable(p, m)) return '这杯暂时无法供应，请选择其他饮品。';
  if (
    p.beans.length &&
    (!p.beans.includes(c.bean) || !m.beans.some((b) => b.id === c.bean && b.available))
  )
    return '请选择有供应的咖啡豆。';
  if (!p.beans.length && c.bean) return '这杯不需要咖啡豆，请调整搭配。';
  if (p.temps.length && !p.temps.includes(c.temp)) return '请选择有效温度。';
  if (!p.temps.length && c.temp) return '这杯没有温度选项。';
  if (p.milks.length && (!p.milks.includes(c.milk) || !m.ingredients[c.milk]))
    return '请选择有供应的奶类。';
  if (!p.milks.length && c.milk) return '这杯不支持奶类。';
  const art = c.temp === '热' && c.milk === '牛奶' && p.arts.length > 0;
  if (art && !p.arts.includes(c.art)) return '请选择拉花，不指定也可以。';
  if (!art && c.art) return '当前搭配不支持拉花。';
  if (p.extraOptions.length && !p.extraOptions.includes(c.extra || ''))
    return '请选择' + (p.extraLabel || '附加选项') + '。';
  if (!p.extraOptions.length && c.extra) return '附加选项已变化，请重新选择。';
  if (typeof c.note !== 'string' || c.note.length > 300) return '备注最多 300 字。';
  return '';
}
export function restoreConfig(
  p: Product,
  m: MenuData,
  old?: Partial<Config>,
  prefs?: Prefs,
): { config: Config; changes: string[] } {
  const source = { ...blankConfig, ...prefs, ...old };
  const c = { ...source };
  const changes: string[] = [];
  const set = (key: keyof Config, valid: string[], label: string) => {
    const prior = String(c[key] || '');
    if (!valid.includes(prior)) {
      c[key] = valid[0] || '';
      if (old && prior && c[key] !== prior)
        changes.push(label + '已变化，已改为' + (c[key] || '无'));
    }
  };
  const beans = p.beans.filter((id) => m.beans.some((b) => b.id === id && b.available));
  const oldBean = c.bean;
  set('bean', beans, '咖啡豆');
  if (oldBean !== c.bean && old?.bean && c.bean)
    changes[changes.length - 1] =
      '咖啡豆供应有变化，已改用' + m.beans.find((b) => b.id === c.bean)?.name + '。';
  set('temp', p.temps, '温度');
  set(
    'milk',
    p.milks.filter((v) => m.ingredients[v]),
    '奶类',
  );
  set('art', c.temp === '热' && c.milk === '牛奶' ? p.arts : [], '拉花');
  set('extra', p.extraOptions, p.extraLabel || '附加选项');
  return { config: c, changes };
}
