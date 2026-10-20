-- 去掉风味介绍中有关预测的措辞，保留原始口感数值。
UPDATE beans SET body=replace(replace(body, '预计', ''), '可能赋予其', '赋予其') WHERE id IN ('afu','peru-sl09','panama-geisha','geisha','colombia-geisha');
UPDATE shop SET catalog_revision=catalog_revision+1 WHERE id=1;
