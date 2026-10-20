-- 店名与用户提供的品牌标志统一。
UPDATE shop SET name='杯叙', catalog_revision=catalog_revision+1 WHERE id=1 AND name='杯序';
