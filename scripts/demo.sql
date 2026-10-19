-- 仅供本地演示。账号007/小林、020/阿宇；店主口令使用.dev.vars配置。
PRAGMA foreign_keys = ON;
INSERT OR IGNORE INTO users (id, name, joined, prefs_json) VALUES
  (7, '小林', '2026-10-13', '{"temp":"热","milk":"牛奶","art":"爱心"}'),
  (20, '阿宇', '2026-10-01', '{"temp":"热","milk":"牛奶","art":""}');

INSERT OR IGNORE INTO orders (id, user_id, username_snapshot, product_id, snapshot_json, status, created_at, completed_at, owner_note, idempotency_key, payload_hash)
VALUES
  ('BEX-DEMO-001', 7, '小林', 'latte', '{"productName":"拿铁","desc":"丝滑柔和，奶香饱满。","photo":"builtin:0","beanName":"意式拼配","config":{"bean":"blend","temp":"热","milk":"牛奶","art":"爱心","note":"奶味明显一点","extra":""}}', 'done', '2026-10-18T06:20:00.000Z', '2026-10-18T06:30:00.000Z', '今天这杯用了新开的豆子，希望你喜欢。', 'demo-001', 'demo-001'),
  ('BEX-DEMO-002', 20, '阿宇', 'dirty', '{"productName":"经典 Dirty","desc":"冷热交错，浓郁又顺滑。","photo":"builtin:2","beanName":"意式拼配","config":{"bean":"blend","temp":"冷饮","milk":"牛奶","art":"","note":"","extra":""}}', 'queued', strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL, '', 'demo-002', 'demo-002');

INSERT INTO reviews (order_id, stars, tags_json, text, updated_at)
VALUES ('BEX-DEMO-001', 4, '["有点浓"]', '上次稍苦，希望奶味再明显一点。', '2026-10-18T06:35:00.000Z')
ON CONFLICT(order_id) DO UPDATE SET stars=excluded.stars, tags_json=excluded.tags_json, text=excluded.text, updated_at=excluded.updated_at;
