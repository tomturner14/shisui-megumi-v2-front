-- Dedicated E2E DB only: different products/sellers at an identical price.
INSERT INTO products(id,seller_id,handle,title,description) VALUES
 ('equal-a','seller-a','equal-a','同額の検証野菜A','同額入替のテスト用・架空'),
 ('equal-b','seller-b','equal-b','同額の検証野菜B','同額売主入替のテスト用・架空');
INSERT INTO skus(id,product_id,label,price_yen) VALUES
 ('equal-a-190','equal-a','1袋',190),('equal-b-190','equal-b','1袋',190);
INSERT INTO inventory(sku_id,on_hand) VALUES ('equal-a-190',5),('equal-b-190',5);
