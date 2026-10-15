-- Fictional fixtures only. Re-running never resets stock of existing orders.
INSERT OR IGNORE INTO sellers(id,name,pickup_conditions) VALUES
 ('seller-a','検証農園A（架空）','検証用条件：架空の受取所A・土曜日10〜12時。実在の場所ではありません。生産者の承諾後に受取条件を確認し、現金で生産者へ支払い。'),
 ('seller-b','検証農園B（架空）','検証用条件：架空の受取所B・日曜日14〜16時。実在の場所ではありません。生産者の承諾後に受取条件を確認し、現金で生産者へ支払い。');
INSERT OR IGNORE INTO products(id,seller_id,handle,title,description) VALUES
 ('carrot','seller-a','carrot','にんじん','架空の検証商品。未加工のにんじんです。写真・産地・提供時期は実販売前に確認が必要です。'),
 ('rice','seller-a','rice','お米','架空の検証商品。未加工の米です。品種や精米日など実商品の表示は実販売前に確認します。'),
 ('potato','seller-b','potato','じゃがいも','架空の検証商品。未加工のじゃがいもです。検証農園Bが売主・代金受取人・引渡担当者です。'),
 ('stopped','seller-a','stopped','販売停止の検証野菜','異常系テスト用・販売停止');
UPDATE products SET active=0 WHERE id='stopped';
INSERT OR IGNORE INTO skus(id,product_id,label,price_yen) VALUES
 ('carrot-500','carrot','500g・1袋',190),('carrot-1kg','carrot','1kg・1袋',350),
 ('rice-2kg','rice','2kg・1袋',1200),('potato-1kg','potato','1kg・1袋',400),
 ('stopped-1','stopped','1袋',100);
INSERT OR IGNORE INTO inventory(sku_id,on_hand) VALUES
 ('carrot-500',20),('carrot-1kg',10),('rice-2kg',8),('potato-1kg',12),('stopped-1',5);
