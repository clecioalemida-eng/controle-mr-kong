-- Execute depois do 012_fornecedor_movimentacao.sql.
-- Produtos das demais seções do cardápio (Petiscos, Bombons e Balas,
-- Extras, Bebidas, Na Chapa, Fritas, Sorvetes, Açaí, Milkshake).
-- Cada um ganha um insumo "espelho" (mesmo nome, quantidade 1) com custo
-- R$0 — aparece em vermelho no app até alguém preencher o custo real ou
-- substituir por uma ficha técnica de verdade com vários ingredientes.
--
-- Nota: nos itens da categoria Extras que têm o mesmo nome de um insumo
-- já cadastrado (Bacon, Alface, Ovo, Presunto, Salsicha, Tomate — usados
-- em kg dentro das fichas técnicas dos hambúrgueres), o produto e o insumo
-- novo levam o sufixo "(extra)" para não se confundir com o insumo em kg
-- já existente (evita um custo de magnitude errada, tipo R$43/kg batendo
-- contra uma porção de R$6,99). Renomeie pelo lápis se quiser bater com o
-- nome exato do CardápioWeb.

-- 1) Produtos
insert into public.pratos (nome, preco_venda) values
  ('Bolinho de costela c/ queijo 350g', 49.99),
  ('Camarão empanado GG recheado com cream cheese 400g (Camafeu)', 79.99),
  ('Croqueta de cupim c/ queijo 350g', 49.99),
  ('Disquinho de costela c/ cheddar e bacon 350g', 49.99),
  ('Frango à passarinho 800g', 44.99),
  ('Isca de frango empanada 450g', 39.99),
  ('Kibe recheado com requeijão cremoso', 49.99),
  ('Mandioca frita 500g', 34.99),
  ('Palitinho Mineiro', 54.99),
  ('Panceta rústica 400gr, mandioca 330gr', 71.99),
  ('Pastelzinho de camarão 350g', 54.99),
  ('Pastelzinho recheado com carne bovina e queijo 350g', 49.99),
  ('Torresminho pururuca', 14.99),
  ('5star', 4.99),
  ('Bananada', 4.99),
  ('Bombom Oreo', 4.99),
  ('Charge', 4.99),
  ('Choquito', 4.99),
  ('Cocada branca', 4.99),
  ('Cocada morena', 4.99),
  ('Diamante negro', 4.99),
  ('Lolo', 4.99),
  ('Prestígio', 4.99),
  ('Halls', 2.99),
  ('Trident', 2.99),
  ('Alface (extra)', 1.99),
  ('Arroz (extra)', 9.99),
  ('Bacon (extra)', 6.99),
  ('Batata palha (extra)', 3.99),
  ('Bife de filé mignon (120gr)', 25.99),
  ('Catupiry (extra)', 3.99),
  ('Cebola (extra)', 1.99),
  ('Cheddar (extra)', 3.99),
  ('Feijão tropeiro (extra)', 9.99),
  ('Frango (extra)', 8.99),
  ('Frango empanado (120gr)', 9.99),
  ('Frango Grelhado (120gr)', 9.99),
  ('Hambúrguer 120g (extra)', 11.99),
  ('Hambúrguer 180g (extra)', 15.99),
  ('Molho verde (extra)', 1.99),
  ('Mussarela (extra)', 3.99),
  ('Ovo (extra)', 4.99),
  ('Presunto (extra)', 1.99),
  ('Queijo ralado (extra)', 2.99),
  ('Salsicha (extra)', 2.99),
  ('Tomate (extra)', 1.99),
  ('Chopp brahma 330ml', 12.99),
  ('Água com gás 500ml', 4.99),
  ('Água sem gás 500ml', 4.99),
  ('Cerveja Heineken 330ml', 12.99),
  ('Cerveja Sol 330ml', 11.99),
  ('Energético Monster 473ml', 16.99),
  ('Refrigerante lata 350ml', 6.99),
  ('Copo especial', 1.99),
  ('Cozumel', 18.99),
  ('Preparo de Cozumel', 10.99),
  ('Suco de frutas 300ml (laranja/limão/morango)', 12.99),
  ('Suco de frutas 500ml (laranja ou limão)', 14.99),
  ('Creme 355ml (morango)', 15.99),
  ('Baldinho com 5 cervejas', 49.99),
  ('Filé Acebolado (480g)', 125.99),
  ('Filé 360gr com fritas (400gr)', 109.99),
  ('Picanha Acebolada 600gr com Fritas (400gr)', 179.99),
  ('Picanha Acebolada 400gr com Fritas (400gr)', 119.99),
  ('Contra filé acebolado (500gr)', 89.99),
  ('Fritas 600gr com bacon 150gr e Catupiry 150gr', 69.99),
  ('Fritas 600gr com Bacon 150gr e Cheddar 150gr', 69.99),
  ('Fritas 600gr com Mussarela (80gr)', 69.99),
  ('Fritas 600gr com Mussarela 80gr e Bacon 150gr', 69.99),
  ('Fritas grande (600gr)', 49.99),
  ('Fritas média (400gr)', 29.99),
  ('Fritas pequena (150gr)', 12.99),
  ('Cascão', 9.99),
  ('Cascão nutella', 12.99),
  ('Sundae colors 270ml (sorvete, waffle, confete e cobertura)', 14.99),
  ('Sundae nut 270ml (sorvete, waffle e cobertura)', 14.99),
  ('Sundae nutella 270ml (sorvete, nutella, waffle, granulado e cobertura)', 16.99),
  ('Kong Açaí 300ml (com 3 acompanhamentos)', 20.99),
  ('Kong Açaí 500ml (com 3 acompanhamentos)', 29.99),
  ('Adicional leite em pó', 3.99),
  ('Adicional banana', 1.99),
  ('Adicional de mel', 3.99),
  ('Adicional de leite condensado', 3.99),
  ('Adicional de amendoim', 3.99),
  ('Adicional de nutella (açaí)', 6.99),
  ('Adicional de granola', 3.99),
  ('Adicional de paçoca', 3.99),
  ('Ovomaltine 500ml (opcionais de chocolate, creme, morango ou paçoca)', 19.99),
  ('Ovomaltine 300ml (opcionais de chocolate, creme, morango ou paçoca)', 14.99),
  ('Adicional nutella (milkshake)', 5.99),
  ('Adicional ovomaltine', 2.99)
on conflict (lower(nome)) do update set preco_venda = excluded.preco_venda;

-- 2) Insumos-espelho (mesmo nome, sem custo ainda)
insert into public.insumos (nome, unidade, custo_medio_atual) values
  ('Bolinho de costela c/ queijo 350g', 'un', 0),
  ('Camarão empanado GG recheado com cream cheese 400g (Camafeu)', 'un', 0),
  ('Croqueta de cupim c/ queijo 350g', 'un', 0),
  ('Disquinho de costela c/ cheddar e bacon 350g', 'un', 0),
  ('Frango à passarinho 800g', 'un', 0),
  ('Isca de frango empanada 450g', 'un', 0),
  ('Kibe recheado com requeijão cremoso', 'un', 0),
  ('Mandioca frita 500g', 'un', 0),
  ('Palitinho Mineiro', 'un', 0),
  ('Panceta rústica 400gr, mandioca 330gr', 'un', 0),
  ('Pastelzinho de camarão 350g', 'un', 0),
  ('Pastelzinho recheado com carne bovina e queijo 350g', 'un', 0),
  ('Torresminho pururuca', 'un', 0),
  ('5star', 'un', 0),
  ('Bananada', 'un', 0),
  ('Bombom Oreo', 'un', 0),
  ('Charge', 'un', 0),
  ('Choquito', 'un', 0),
  ('Cocada branca', 'un', 0),
  ('Cocada morena', 'un', 0),
  ('Diamante negro', 'un', 0),
  ('Lolo', 'un', 0),
  ('Prestígio', 'un', 0),
  ('Halls', 'un', 0),
  ('Trident', 'un', 0),
  ('Alface (extra)', 'un', 0),
  ('Arroz (extra)', 'un', 0),
  ('Bacon (extra)', 'un', 0),
  ('Batata palha (extra)', 'un', 0),
  ('Bife de filé mignon (120gr)', 'un', 0),
  ('Catupiry (extra)', 'un', 0),
  ('Cebola (extra)', 'un', 0),
  ('Cheddar (extra)', 'un', 0),
  ('Feijão tropeiro (extra)', 'un', 0),
  ('Frango (extra)', 'un', 0),
  ('Frango empanado (120gr)', 'un', 0),
  ('Frango Grelhado (120gr)', 'un', 0),
  ('Hambúrguer 120g (extra)', 'un', 0),
  ('Hambúrguer 180g (extra)', 'un', 0),
  ('Molho verde (extra)', 'un', 0),
  ('Mussarela (extra)', 'un', 0),
  ('Ovo (extra)', 'un', 0),
  ('Presunto (extra)', 'un', 0),
  ('Queijo ralado (extra)', 'un', 0),
  ('Salsicha (extra)', 'un', 0),
  ('Tomate (extra)', 'un', 0),
  ('Chopp brahma 330ml', 'un', 0),
  ('Água com gás 500ml', 'un', 0),
  ('Água sem gás 500ml', 'un', 0),
  ('Cerveja Heineken 330ml', 'un', 0),
  ('Cerveja Sol 330ml', 'un', 0),
  ('Energético Monster 473ml', 'un', 0),
  ('Refrigerante lata 350ml', 'un', 0),
  ('Copo especial', 'un', 0),
  ('Cozumel', 'un', 0),
  ('Preparo de Cozumel', 'un', 0),
  ('Suco de frutas 300ml (laranja/limão/morango)', 'un', 0),
  ('Suco de frutas 500ml (laranja ou limão)', 'un', 0),
  ('Creme 355ml (morango)', 'un', 0),
  ('Baldinho com 5 cervejas', 'un', 0),
  ('Filé Acebolado (480g)', 'un', 0),
  ('Filé 360gr com fritas (400gr)', 'un', 0),
  ('Picanha Acebolada 600gr com Fritas (400gr)', 'un', 0),
  ('Picanha Acebolada 400gr com Fritas (400gr)', 'un', 0),
  ('Contra filé acebolado (500gr)', 'un', 0),
  ('Fritas 600gr com bacon 150gr e Catupiry 150gr', 'un', 0),
  ('Fritas 600gr com Bacon 150gr e Cheddar 150gr', 'un', 0),
  ('Fritas 600gr com Mussarela (80gr)', 'un', 0),
  ('Fritas 600gr com Mussarela 80gr e Bacon 150gr', 'un', 0),
  ('Fritas grande (600gr)', 'un', 0),
  ('Fritas média (400gr)', 'un', 0),
  ('Fritas pequena (150gr)', 'un', 0),
  ('Cascão', 'un', 0),
  ('Cascão nutella', 'un', 0),
  ('Sundae colors 270ml (sorvete, waffle, confete e cobertura)', 'un', 0),
  ('Sundae nut 270ml (sorvete, waffle e cobertura)', 'un', 0),
  ('Sundae nutella 270ml (sorvete, nutella, waffle, granulado e cobertura)', 'un', 0),
  ('Kong Açaí 300ml (com 3 acompanhamentos)', 'un', 0),
  ('Kong Açaí 500ml (com 3 acompanhamentos)', 'un', 0),
  ('Adicional leite em pó', 'un', 0),
  ('Adicional banana', 'un', 0),
  ('Adicional de mel', 'un', 0),
  ('Adicional de leite condensado', 'un', 0),
  ('Adicional de amendoim', 'un', 0),
  ('Adicional de nutella (açaí)', 'un', 0),
  ('Adicional de granola', 'un', 0),
  ('Adicional de paçoca', 'un', 0),
  ('Ovomaltine 500ml (opcionais de chocolate, creme, morango ou paçoca)', 'un', 0),
  ('Ovomaltine 300ml (opcionais de chocolate, creme, morango ou paçoca)', 'un', 0),
  ('Adicional nutella (milkshake)', 'un', 0),
  ('Adicional ovomaltine', 'un', 0)
on conflict (lower(nome)) do nothing;

-- 3) Liga cada produto ao seu insumo-espelho, quantidade 1
insert into public.prato_insumos (prato_id, insumo_id, quantidade)
select (select id from public.pratos where nome = 'Bolinho de costela c/ queijo 350g'), (select id from public.insumos where nome = 'Bolinho de costela c/ queijo 350g'), 1
union all
select (select id from public.pratos where nome = 'Camarão empanado GG recheado com cream cheese 400g (Camafeu)'), (select id from public.insumos where nome = 'Camarão empanado GG recheado com cream cheese 400g (Camafeu)'), 1
union all
select (select id from public.pratos where nome = 'Croqueta de cupim c/ queijo 350g'), (select id from public.insumos where nome = 'Croqueta de cupim c/ queijo 350g'), 1
union all
select (select id from public.pratos where nome = 'Disquinho de costela c/ cheddar e bacon 350g'), (select id from public.insumos where nome = 'Disquinho de costela c/ cheddar e bacon 350g'), 1
union all
select (select id from public.pratos where nome = 'Frango à passarinho 800g'), (select id from public.insumos where nome = 'Frango à passarinho 800g'), 1
union all
select (select id from public.pratos where nome = 'Isca de frango empanada 450g'), (select id from public.insumos where nome = 'Isca de frango empanada 450g'), 1
union all
select (select id from public.pratos where nome = 'Kibe recheado com requeijão cremoso'), (select id from public.insumos where nome = 'Kibe recheado com requeijão cremoso'), 1
union all
select (select id from public.pratos where nome = 'Mandioca frita 500g'), (select id from public.insumos where nome = 'Mandioca frita 500g'), 1
union all
select (select id from public.pratos where nome = 'Palitinho Mineiro'), (select id from public.insumos where nome = 'Palitinho Mineiro'), 1
union all
select (select id from public.pratos where nome = 'Panceta rústica 400gr, mandioca 330gr'), (select id from public.insumos where nome = 'Panceta rústica 400gr, mandioca 330gr'), 1
union all
select (select id from public.pratos where nome = 'Pastelzinho de camarão 350g'), (select id from public.insumos where nome = 'Pastelzinho de camarão 350g'), 1
union all
select (select id from public.pratos where nome = 'Pastelzinho recheado com carne bovina e queijo 350g'), (select id from public.insumos where nome = 'Pastelzinho recheado com carne bovina e queijo 350g'), 1
union all
select (select id from public.pratos where nome = 'Torresminho pururuca'), (select id from public.insumos where nome = 'Torresminho pururuca'), 1
union all
select (select id from public.pratos where nome = '5star'), (select id from public.insumos where nome = '5star'), 1
union all
select (select id from public.pratos where nome = 'Bananada'), (select id from public.insumos where nome = 'Bananada'), 1
union all
select (select id from public.pratos where nome = 'Bombom Oreo'), (select id from public.insumos where nome = 'Bombom Oreo'), 1
union all
select (select id from public.pratos where nome = 'Charge'), (select id from public.insumos where nome = 'Charge'), 1
union all
select (select id from public.pratos where nome = 'Choquito'), (select id from public.insumos where nome = 'Choquito'), 1
union all
select (select id from public.pratos where nome = 'Cocada branca'), (select id from public.insumos where nome = 'Cocada branca'), 1
union all
select (select id from public.pratos where nome = 'Cocada morena'), (select id from public.insumos where nome = 'Cocada morena'), 1
union all
select (select id from public.pratos where nome = 'Diamante negro'), (select id from public.insumos where nome = 'Diamante negro'), 1
union all
select (select id from public.pratos where nome = 'Lolo'), (select id from public.insumos where nome = 'Lolo'), 1
union all
select (select id from public.pratos where nome = 'Prestígio'), (select id from public.insumos where nome = 'Prestígio'), 1
union all
select (select id from public.pratos where nome = 'Halls'), (select id from public.insumos where nome = 'Halls'), 1
union all
select (select id from public.pratos where nome = 'Trident'), (select id from public.insumos where nome = 'Trident'), 1
union all
select (select id from public.pratos where nome = 'Alface (extra)'), (select id from public.insumos where nome = 'Alface (extra)'), 1
union all
select (select id from public.pratos where nome = 'Arroz (extra)'), (select id from public.insumos where nome = 'Arroz (extra)'), 1
union all
select (select id from public.pratos where nome = 'Bacon (extra)'), (select id from public.insumos where nome = 'Bacon (extra)'), 1
union all
select (select id from public.pratos where nome = 'Batata palha (extra)'), (select id from public.insumos where nome = 'Batata palha (extra)'), 1
union all
select (select id from public.pratos where nome = 'Bife de filé mignon (120gr)'), (select id from public.insumos where nome = 'Bife de filé mignon (120gr)'), 1
union all
select (select id from public.pratos where nome = 'Catupiry (extra)'), (select id from public.insumos where nome = 'Catupiry (extra)'), 1
union all
select (select id from public.pratos where nome = 'Cebola (extra)'), (select id from public.insumos where nome = 'Cebola (extra)'), 1
union all
select (select id from public.pratos where nome = 'Cheddar (extra)'), (select id from public.insumos where nome = 'Cheddar (extra)'), 1
union all
select (select id from public.pratos where nome = 'Feijão tropeiro (extra)'), (select id from public.insumos where nome = 'Feijão tropeiro (extra)'), 1
union all
select (select id from public.pratos where nome = 'Frango (extra)'), (select id from public.insumos where nome = 'Frango (extra)'), 1
union all
select (select id from public.pratos where nome = 'Frango empanado (120gr)'), (select id from public.insumos where nome = 'Frango empanado (120gr)'), 1
union all
select (select id from public.pratos where nome = 'Frango Grelhado (120gr)'), (select id from public.insumos where nome = 'Frango Grelhado (120gr)'), 1
union all
select (select id from public.pratos where nome = 'Hambúrguer 120g (extra)'), (select id from public.insumos where nome = 'Hambúrguer 120g (extra)'), 1
union all
select (select id from public.pratos where nome = 'Hambúrguer 180g (extra)'), (select id from public.insumos where nome = 'Hambúrguer 180g (extra)'), 1
union all
select (select id from public.pratos where nome = 'Molho verde (extra)'), (select id from public.insumos where nome = 'Molho verde (extra)'), 1
union all
select (select id from public.pratos where nome = 'Mussarela (extra)'), (select id from public.insumos where nome = 'Mussarela (extra)'), 1
union all
select (select id from public.pratos where nome = 'Ovo (extra)'), (select id from public.insumos where nome = 'Ovo (extra)'), 1
union all
select (select id from public.pratos where nome = 'Presunto (extra)'), (select id from public.insumos where nome = 'Presunto (extra)'), 1
union all
select (select id from public.pratos where nome = 'Queijo ralado (extra)'), (select id from public.insumos where nome = 'Queijo ralado (extra)'), 1
union all
select (select id from public.pratos where nome = 'Salsicha (extra)'), (select id from public.insumos where nome = 'Salsicha (extra)'), 1
union all
select (select id from public.pratos where nome = 'Tomate (extra)'), (select id from public.insumos where nome = 'Tomate (extra)'), 1
union all
select (select id from public.pratos where nome = 'Chopp brahma 330ml'), (select id from public.insumos where nome = 'Chopp brahma 330ml'), 1
union all
select (select id from public.pratos where nome = 'Água com gás 500ml'), (select id from public.insumos where nome = 'Água com gás 500ml'), 1
union all
select (select id from public.pratos where nome = 'Água sem gás 500ml'), (select id from public.insumos where nome = 'Água sem gás 500ml'), 1
union all
select (select id from public.pratos where nome = 'Cerveja Heineken 330ml'), (select id from public.insumos where nome = 'Cerveja Heineken 330ml'), 1
union all
select (select id from public.pratos where nome = 'Cerveja Sol 330ml'), (select id from public.insumos where nome = 'Cerveja Sol 330ml'), 1
union all
select (select id from public.pratos where nome = 'Energético Monster 473ml'), (select id from public.insumos where nome = 'Energético Monster 473ml'), 1
union all
select (select id from public.pratos where nome = 'Refrigerante lata 350ml'), (select id from public.insumos where nome = 'Refrigerante lata 350ml'), 1
union all
select (select id from public.pratos where nome = 'Copo especial'), (select id from public.insumos where nome = 'Copo especial'), 1
union all
select (select id from public.pratos where nome = 'Cozumel'), (select id from public.insumos where nome = 'Cozumel'), 1
union all
select (select id from public.pratos where nome = 'Preparo de Cozumel'), (select id from public.insumos where nome = 'Preparo de Cozumel'), 1
union all
select (select id from public.pratos where nome = 'Suco de frutas 300ml (laranja/limão/morango)'), (select id from public.insumos where nome = 'Suco de frutas 300ml (laranja/limão/morango)'), 1
union all
select (select id from public.pratos where nome = 'Suco de frutas 500ml (laranja ou limão)'), (select id from public.insumos where nome = 'Suco de frutas 500ml (laranja ou limão)'), 1
union all
select (select id from public.pratos where nome = 'Creme 355ml (morango)'), (select id from public.insumos where nome = 'Creme 355ml (morango)'), 1
union all
select (select id from public.pratos where nome = 'Baldinho com 5 cervejas'), (select id from public.insumos where nome = 'Baldinho com 5 cervejas'), 1
union all
select (select id from public.pratos where nome = 'Filé Acebolado (480g)'), (select id from public.insumos where nome = 'Filé Acebolado (480g)'), 1
union all
select (select id from public.pratos where nome = 'Filé 360gr com fritas (400gr)'), (select id from public.insumos where nome = 'Filé 360gr com fritas (400gr)'), 1
union all
select (select id from public.pratos where nome = 'Picanha Acebolada 600gr com Fritas (400gr)'), (select id from public.insumos where nome = 'Picanha Acebolada 600gr com Fritas (400gr)'), 1
union all
select (select id from public.pratos where nome = 'Picanha Acebolada 400gr com Fritas (400gr)'), (select id from public.insumos where nome = 'Picanha Acebolada 400gr com Fritas (400gr)'), 1
union all
select (select id from public.pratos where nome = 'Contra filé acebolado (500gr)'), (select id from public.insumos where nome = 'Contra filé acebolado (500gr)'), 1
union all
select (select id from public.pratos where nome = 'Fritas 600gr com bacon 150gr e Catupiry 150gr'), (select id from public.insumos where nome = 'Fritas 600gr com bacon 150gr e Catupiry 150gr'), 1
union all
select (select id from public.pratos where nome = 'Fritas 600gr com Bacon 150gr e Cheddar 150gr'), (select id from public.insumos where nome = 'Fritas 600gr com Bacon 150gr e Cheddar 150gr'), 1
union all
select (select id from public.pratos where nome = 'Fritas 600gr com Mussarela (80gr)'), (select id from public.insumos where nome = 'Fritas 600gr com Mussarela (80gr)'), 1
union all
select (select id from public.pratos where nome = 'Fritas 600gr com Mussarela 80gr e Bacon 150gr'), (select id from public.insumos where nome = 'Fritas 600gr com Mussarela 80gr e Bacon 150gr'), 1
union all
select (select id from public.pratos where nome = 'Fritas grande (600gr)'), (select id from public.insumos where nome = 'Fritas grande (600gr)'), 1
union all
select (select id from public.pratos where nome = 'Fritas média (400gr)'), (select id from public.insumos where nome = 'Fritas média (400gr)'), 1
union all
select (select id from public.pratos where nome = 'Fritas pequena (150gr)'), (select id from public.insumos where nome = 'Fritas pequena (150gr)'), 1
union all
select (select id from public.pratos where nome = 'Cascão'), (select id from public.insumos where nome = 'Cascão'), 1
union all
select (select id from public.pratos where nome = 'Cascão nutella'), (select id from public.insumos where nome = 'Cascão nutella'), 1
union all
select (select id from public.pratos where nome = 'Sundae colors 270ml (sorvete, waffle, confete e cobertura)'), (select id from public.insumos where nome = 'Sundae colors 270ml (sorvete, waffle, confete e cobertura)'), 1
union all
select (select id from public.pratos where nome = 'Sundae nut 270ml (sorvete, waffle e cobertura)'), (select id from public.insumos where nome = 'Sundae nut 270ml (sorvete, waffle e cobertura)'), 1
union all
select (select id from public.pratos where nome = 'Sundae nutella 270ml (sorvete, nutella, waffle, granulado e cobertura)'), (select id from public.insumos where nome = 'Sundae nutella 270ml (sorvete, nutella, waffle, granulado e cobertura)'), 1
union all
select (select id from public.pratos where nome = 'Kong Açaí 300ml (com 3 acompanhamentos)'), (select id from public.insumos where nome = 'Kong Açaí 300ml (com 3 acompanhamentos)'), 1
union all
select (select id from public.pratos where nome = 'Kong Açaí 500ml (com 3 acompanhamentos)'), (select id from public.insumos where nome = 'Kong Açaí 500ml (com 3 acompanhamentos)'), 1
union all
select (select id from public.pratos where nome = 'Adicional leite em pó'), (select id from public.insumos where nome = 'Adicional leite em pó'), 1
union all
select (select id from public.pratos where nome = 'Adicional banana'), (select id from public.insumos where nome = 'Adicional banana'), 1
union all
select (select id from public.pratos where nome = 'Adicional de mel'), (select id from public.insumos where nome = 'Adicional de mel'), 1
union all
select (select id from public.pratos where nome = 'Adicional de leite condensado'), (select id from public.insumos where nome = 'Adicional de leite condensado'), 1
union all
select (select id from public.pratos where nome = 'Adicional de amendoim'), (select id from public.insumos where nome = 'Adicional de amendoim'), 1
union all
select (select id from public.pratos where nome = 'Adicional de nutella (açaí)'), (select id from public.insumos where nome = 'Adicional de nutella (açaí)'), 1
union all
select (select id from public.pratos where nome = 'Adicional de granola'), (select id from public.insumos where nome = 'Adicional de granola'), 1
union all
select (select id from public.pratos where nome = 'Adicional de paçoca'), (select id from public.insumos where nome = 'Adicional de paçoca'), 1
union all
select (select id from public.pratos where nome = 'Ovomaltine 500ml (opcionais de chocolate, creme, morango ou paçoca)'), (select id from public.insumos where nome = 'Ovomaltine 500ml (opcionais de chocolate, creme, morango ou paçoca)'), 1
union all
select (select id from public.pratos where nome = 'Ovomaltine 300ml (opcionais de chocolate, creme, morango ou paçoca)'), (select id from public.insumos where nome = 'Ovomaltine 300ml (opcionais de chocolate, creme, morango ou paçoca)'), 1
union all
select (select id from public.pratos where nome = 'Adicional nutella (milkshake)'), (select id from public.insumos where nome = 'Adicional nutella (milkshake)'), 1
union all
select (select id from public.pratos where nome = 'Adicional ovomaltine'), (select id from public.insumos where nome = 'Adicional ovomaltine'), 1
on conflict (prato_id, insumo_id) do update set quantidade = excluded.quantidade;