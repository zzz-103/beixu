import { describe, expect, it } from 'vitest';
import { restoreConfig, validateConfig } from '../src/shared/domain';
import { levelFor, shanghaiDate, type MenuData, type Product } from '../src/shared/types';

const product: Product = {
  id: 'latte',
  name: '拿铁',
  english: 'Caffè Latte',
  categoryId: 'espresso',
  desc: '丝滑柔和，奶香饱满。',
  story: '',
  photo: 'builtin:0',
  beans: ['blend', 'blue'],
  temps: ['热', '冰'],
  milks: ['牛奶', '燕麦奶'],
  arts: ['不指定', '爱心', '树叶', '郁金香'],
  extraLabel: '',
  extraOptions: [],
  available: true,
};

const menu: MenuData = {
  shop: { name: '杯叙', message: '', recommendedId: 'latte', open: true },
  categories: [{ id: 'espresso', name: '意式咖啡', enabled: true, position: 0 }],
  products: [product],
  beans: [
    {
      id: 'blend',
      name: '意式拼配',
      origin: '',
      variety: '',
      roast: '',
      tags: [],
      scales: [2, 3, 4],
      front: '',
      body: '',
      finish: '',
      note: '',
      available: true,
    },
    {
      id: 'blue',
      name: '蓝山豆',
      origin: '',
      variety: '',
      roast: '',
      tags: [],
      scales: [2, 2, 4],
      front: '',
      body: '',
      finish: '',
      note: '',
      available: true,
    },
    {
      id: 'geisha',
      name: '埃塞瑰夏',
      origin: '',
      variety: '',
      roast: '',
      tags: [],
      scales: [4, 1, 2],
      front: '',
      body: '',
      finish: '',
      note: '',
      available: false,
    },
  ],
  ingredients: { 牛奶: true, 燕麦奶: true },
  people: {},
};

describe('选配领域规则', () => {
  it('首次使用采用有效偏好和饮品默认豆子', () => {
    const restored = restoreConfig(product, menu, undefined, {
      temp: '热',
      milk: '牛奶',
      art: '爱心',
    });
    expect(restored.config).toMatchObject({ bean: 'blend', temp: '热', milk: '牛奶', art: '爱心' });
    expect(restored.changes).toEqual([]);
  });

  it('历史搭配失效时切换到有效选项并列出变化', () => {
    const restored = restoreConfig(product, menu, {
      bean: 'geisha',
      temp: '热',
      milk: '牛奶',
      art: '爱心',
      note: '',
      extra: '',
    });
    expect(restored.config.bean).toBe('blend');
    expect(restored.changes.some((change) => change.includes('咖啡豆供应有变化'))).toBe(true);
  });

  it('冰饮或燕麦奶会清除拉花', () => {
    const iced = restoreConfig(product, menu, {
      bean: 'blend',
      temp: '冰',
      milk: '牛奶',
      art: '爱心',
      note: '',
      extra: '',
    });
    const oat = restoreConfig(product, menu, {
      bean: 'blend',
      temp: '热',
      milk: '燕麦奶',
      art: '爱心',
      note: '',
      extra: '',
    });
    expect(iced.config.art).toBe('');
    expect(oat.config.art).toBe('');
  });

  it('校验有效搭配和失效搭配', () => {
    expect(
      validateConfig(
        product,
        { bean: 'blend', temp: '热', milk: '牛奶', art: '爱心', note: '', extra: '' },
        menu,
      ),
    ).toBe('');
    expect(
      validateConfig(
        product,
        { bean: 'geisha', temp: '热', milk: '牛奶', art: '爱心', note: '', extra: '' },
        menu,
      ),
    ).toContain('咖啡豆');
    expect(
      validateConfig(
        product,
        { bean: 'blend', temp: '冰', milk: '牛奶', art: '爱心', note: '', extra: '' },
        menu,
      ),
    ).toContain('拉花');
    expect(
      validateConfig(
        product,
        { bean: 'blend', temp: '热', milk: '燕麦奶', art: '爱心', note: '', extra: '' },
        menu,
      ),
    ).toContain('拉花');
  });
});

describe('熟客统计领域规则', () => {
  it('按上海时区计算日期和熟客等级阈值', () => {
    expect(shanghaiDate('2026-10-19T16:30:00.000Z')).toBe('2026-10-20');
    expect(levelFor(0)).toBe('等你来坐');
    expect(levelFor(1)).toBe('初次来坐');
    expect(levelFor(3)).toBe('熟面孔');
    expect(levelFor(6)).toBe('老位置');
    expect(levelFor(10)).toBe('吧台常驻');
  });
});
