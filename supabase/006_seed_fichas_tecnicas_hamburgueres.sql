-- Execute depois do 005_pratos_nome_unico.sql (SQL Editor > New query > Run).
-- Fichas técnicas dos 14 hambúrgueres, extraídas e conferidas a partir da
-- planilha 'Cardápio Mr Kong com custo e preços' enviada em 18/08/2026.
-- Custo = só insumo (não inclui mão de obra/embalagem de preparo além do
-- listado). Kongzilla importado conforme a planilha de custo (sem cheddar,
-- provolone ou cebola caramelizada, mesmo a descrição do cardápio citando
-- esses itens) — ajustar depois pelo app se a receita real for diferente.

-- 1) Insumos
insert into public.insumos (nome, unidade, custo_medio_atual) values
  ('Blend de costela 180g', 'un', 7.0),
  ('Blend de costela 120g', 'un', 5.0),
  ('Frango grelhado 120g', 'un', 4.0),
  ('Pão brioche', 'un', 2.0),
  ('Mussarela', 'kg', 43.99),
  ('Maionese', 'kg', 41.99),
  ('Ketchup', 'kg', 39.99),
  ('Molho tártaro', 'kg', 1.0),
  ('Papel acoplado (rolo)', 'un', 81.0),
  ('Saco kraft (pacote)', 'un', 199.0),
  ('Ovo', 'un', 2.0),
  ('Queijo empanado especial', 'kg', 39.0),
  ('Alface', 'kg', 10.0),
  ('Bacon', 'kg', 42.99),
  ('Tomate', 'kg', 10.0),
  ('Cebola caramelizada', 'kg', 2.96),
  ('Abacaxi grelhado', 'kg', 11.99),
  ('Salsicha', 'kg', 37.47),
  ('Gorgonzola', 'kg', 199.0),
  ('Rúcula', 'kg', 4.0),
  ('Queijo cheddar', 'kg', 60.0),
  ('Cebola crispy', 'un', 1.0),
  ('Presunto', 'kg', 60.0)
on conflict (lower(nome)) do nothing;

-- 2) Pratos (preço de venda vem do cardápio principal da planilha)
insert into public.pratos (nome, preco_venda) values
  ('Sagui-pigmeu', 29.99),
  ('Colobus', 34.99),
  ('Kong Dril', 57.99),
  ('Kong Uacari', 40.99),
  ('Kong Orangotango-de-Bornéu (Clássico)', 41.99),
  ('Kong Langur', 42.99),
  ('King Kong', 64.99),
  ('Kong Gibão', 53.99),
  ('Kongzilla', 82.99),
  ('Rei da Selva (X-Tudo)', 47.99),
  ('Selva Burguer (X-Salada Especial)', 37.99),
  ('Mico Dourado (X-Chicken)', 34.99),
  ('Mico Verde (X-Salada de Frango)', 28.99),
  ('Mico Especial (X-Bacon Especial)', 41.99)
on conflict (lower(nome)) do update set preco_venda = excluded.preco_venda;

-- 3) Composição de cada prato (a ficha técnica em si)
insert into public.prato_insumos (prato_id, insumo_id, quantidade)
select (select id from public.pratos where nome = 'Sagui-pigmeu'), (select id from public.insumos where nome = 'Blend de costela 120g'), 1.0
union all
select (select id from public.pratos where nome = 'Sagui-pigmeu'), (select id from public.insumos where nome = 'Pão brioche'), 1.0
union all
select (select id from public.pratos where nome = 'Sagui-pigmeu'), (select id from public.insumos where nome = 'Mussarela'), 0.03
union all
select (select id from public.pratos where nome = 'Sagui-pigmeu'), (select id from public.insumos where nome = 'Maionese'), 0.006944
union all
select (select id from public.pratos where nome = 'Sagui-pigmeu'), (select id from public.insumos where nome = 'Ketchup'), 0.013889
union all
select (select id from public.pratos where nome = 'Sagui-pigmeu'), (select id from public.insumos where nome = 'Molho tártaro'), 0.3
union all
select (select id from public.pratos where nome = 'Sagui-pigmeu'), (select id from public.insumos where nome = 'Papel acoplado (rolo)'), 0.0004
union all
select (select id from public.pratos where nome = 'Sagui-pigmeu'), (select id from public.insumos where nome = 'Saco kraft (pacote)'), 0.004
union all
select (select id from public.pratos where nome = 'Colobus'), (select id from public.insumos where nome = 'Blend de costela 180g'), 1.0
union all
select (select id from public.pratos where nome = 'Colobus'), (select id from public.insumos where nome = 'Pão brioche'), 1.0
union all
select (select id from public.pratos where nome = 'Colobus'), (select id from public.insumos where nome = 'Mussarela'), 0.03
union all
select (select id from public.pratos where nome = 'Colobus'), (select id from public.insumos where nome = 'Maionese'), 0.006944
union all
select (select id from public.pratos where nome = 'Colobus'), (select id from public.insumos where nome = 'Ketchup'), 0.013889
union all
select (select id from public.pratos where nome = 'Colobus'), (select id from public.insumos where nome = 'Molho tártaro'), 0.3
union all
select (select id from public.pratos where nome = 'Colobus'), (select id from public.insumos where nome = 'Papel acoplado (rolo)'), 0.0004
union all
select (select id from public.pratos where nome = 'Colobus'), (select id from public.insumos where nome = 'Saco kraft (pacote)'), 0.004
union all
select (select id from public.pratos where nome = 'Kong Dril'), (select id from public.insumos where nome = 'Blend de costela 180g'), 1.0
union all
select (select id from public.pratos where nome = 'Kong Dril'), (select id from public.insumos where nome = 'Pão brioche'), 1.0
union all
select (select id from public.pratos where nome = 'Kong Dril'), (select id from public.insumos where nome = 'Maionese'), 0.006944
union all
select (select id from public.pratos where nome = 'Kong Dril'), (select id from public.insumos where nome = 'Ketchup'), 0.013889
union all
select (select id from public.pratos where nome = 'Kong Dril'), (select id from public.insumos where nome = 'Molho tártaro'), 0.3
union all
select (select id from public.pratos where nome = 'Kong Dril'), (select id from public.insumos where nome = 'Papel acoplado (rolo)'), 0.0004
union all
select (select id from public.pratos where nome = 'Kong Dril'), (select id from public.insumos where nome = 'Saco kraft (pacote)'), 0.004
union all
select (select id from public.pratos where nome = 'Kong Dril'), (select id from public.insumos where nome = 'Bacon'), 0.038
union all
select (select id from public.pratos where nome = 'Kong Dril'), (select id from public.insumos where nome = 'Abacaxi grelhado'), 0.2
union all
select (select id from public.pratos where nome = 'Kong Dril'), (select id from public.insumos where nome = 'Gorgonzola'), 0.025
union all
select (select id from public.pratos where nome = 'Kong Dril'), (select id from public.insumos where nome = 'Rúcula'), 0.333333
union all
select (select id from public.pratos where nome = 'Kong Uacari'), (select id from public.insumos where nome = 'Blend de costela 180g'), 1.0
union all
select (select id from public.pratos where nome = 'Kong Uacari'), (select id from public.insumos where nome = 'Pão brioche'), 1.0
union all
select (select id from public.pratos where nome = 'Kong Uacari'), (select id from public.insumos where nome = 'Mussarela'), 0.03
union all
select (select id from public.pratos where nome = 'Kong Uacari'), (select id from public.insumos where nome = 'Maionese'), 0.006944
union all
select (select id from public.pratos where nome = 'Kong Uacari'), (select id from public.insumos where nome = 'Ketchup'), 0.013889
union all
select (select id from public.pratos where nome = 'Kong Uacari'), (select id from public.insumos where nome = 'Molho tártaro'), 0.3
union all
select (select id from public.pratos where nome = 'Kong Uacari'), (select id from public.insumos where nome = 'Papel acoplado (rolo)'), 0.0004
union all
select (select id from public.pratos where nome = 'Kong Uacari'), (select id from public.insumos where nome = 'Saco kraft (pacote)'), 0.004
union all
select (select id from public.pratos where nome = 'Kong Uacari'), (select id from public.insumos where nome = 'Bacon'), 0.038
union all
select (select id from public.pratos where nome = 'Kong Uacari'), (select id from public.insumos where nome = 'Cebola caramelizada'), 0.1
union all
select (select id from public.pratos where nome = 'Kong Orangotango-de-Bornéu (Clássico)'), (select id from public.insumos where nome = 'Blend de costela 180g'), 1.0
union all
select (select id from public.pratos where nome = 'Kong Orangotango-de-Bornéu (Clássico)'), (select id from public.insumos where nome = 'Pão brioche'), 1.0
union all
select (select id from public.pratos where nome = 'Kong Orangotango-de-Bornéu (Clássico)'), (select id from public.insumos where nome = 'Mussarela'), 0.03
union all
select (select id from public.pratos where nome = 'Kong Orangotango-de-Bornéu (Clássico)'), (select id from public.insumos where nome = 'Maionese'), 0.006944
union all
select (select id from public.pratos where nome = 'Kong Orangotango-de-Bornéu (Clássico)'), (select id from public.insumos where nome = 'Ketchup'), 0.013889
union all
select (select id from public.pratos where nome = 'Kong Orangotango-de-Bornéu (Clássico)'), (select id from public.insumos where nome = 'Molho tártaro'), 0.3
union all
select (select id from public.pratos where nome = 'Kong Orangotango-de-Bornéu (Clássico)'), (select id from public.insumos where nome = 'Papel acoplado (rolo)'), 0.0004
union all
select (select id from public.pratos where nome = 'Kong Orangotango-de-Bornéu (Clássico)'), (select id from public.insumos where nome = 'Saco kraft (pacote)'), 0.004
union all
select (select id from public.pratos where nome = 'Kong Orangotango-de-Bornéu (Clássico)'), (select id from public.insumos where nome = 'Alface'), 0.02
union all
select (select id from public.pratos where nome = 'Kong Orangotango-de-Bornéu (Clássico)'), (select id from public.insumos where nome = 'Bacon'), 0.038
union all
select (select id from public.pratos where nome = 'Kong Orangotango-de-Bornéu (Clássico)'), (select id from public.insumos where nome = 'Tomate'), 0.05
union all
select (select id from public.pratos where nome = 'Kong Langur'), (select id from public.insumos where nome = 'Blend de costela 180g'), 1.0
union all
select (select id from public.pratos where nome = 'Kong Langur'), (select id from public.insumos where nome = 'Pão brioche'), 1.0
union all
select (select id from public.pratos where nome = 'Kong Langur'), (select id from public.insumos where nome = 'Maionese'), 0.006944
union all
select (select id from public.pratos where nome = 'Kong Langur'), (select id from public.insumos where nome = 'Ketchup'), 0.013889
union all
select (select id from public.pratos where nome = 'Kong Langur'), (select id from public.insumos where nome = 'Molho tártaro'), 0.3
union all
select (select id from public.pratos where nome = 'Kong Langur'), (select id from public.insumos where nome = 'Papel acoplado (rolo)'), 0.0004
union all
select (select id from public.pratos where nome = 'Kong Langur'), (select id from public.insumos where nome = 'Saco kraft (pacote)'), 0.004
union all
select (select id from public.pratos where nome = 'Kong Langur'), (select id from public.insumos where nome = 'Queijo empanado especial'), 0.1
union all
select (select id from public.pratos where nome = 'King Kong'), (select id from public.insumos where nome = 'Blend de costela 180g'), 2.0
union all
select (select id from public.pratos where nome = 'King Kong'), (select id from public.insumos where nome = 'Pão brioche'), 1.0
union all
select (select id from public.pratos where nome = 'King Kong'), (select id from public.insumos where nome = 'Mussarela'), 0.03
union all
select (select id from public.pratos where nome = 'King Kong'), (select id from public.insumos where nome = 'Maionese'), 0.006944
union all
select (select id from public.pratos where nome = 'King Kong'), (select id from public.insumos where nome = 'Ketchup'), 0.013889
union all
select (select id from public.pratos where nome = 'King Kong'), (select id from public.insumos where nome = 'Molho tártaro'), 0.3
union all
select (select id from public.pratos where nome = 'King Kong'), (select id from public.insumos where nome = 'Papel acoplado (rolo)'), 0.0004
union all
select (select id from public.pratos where nome = 'King Kong'), (select id from public.insumos where nome = 'Saco kraft (pacote)'), 0.004
union all
select (select id from public.pratos where nome = 'King Kong'), (select id from public.insumos where nome = 'Bacon'), 0.076
union all
select (select id from public.pratos where nome = 'Kong Gibão'), (select id from public.insumos where nome = 'Blend de costela 180g'), 1.0
union all
select (select id from public.pratos where nome = 'Kong Gibão'), (select id from public.insumos where nome = 'Pão brioche'), 1.0
union all
select (select id from public.pratos where nome = 'Kong Gibão'), (select id from public.insumos where nome = 'Mussarela'), 0.03
union all
select (select id from public.pratos where nome = 'Kong Gibão'), (select id from public.insumos where nome = 'Maionese'), 0.006944
union all
select (select id from public.pratos where nome = 'Kong Gibão'), (select id from public.insumos where nome = 'Ketchup'), 0.013889
union all
select (select id from public.pratos where nome = 'Kong Gibão'), (select id from public.insumos where nome = 'Molho tártaro'), 0.3
union all
select (select id from public.pratos where nome = 'Kong Gibão'), (select id from public.insumos where nome = 'Papel acoplado (rolo)'), 0.0004
union all
select (select id from public.pratos where nome = 'Kong Gibão'), (select id from public.insumos where nome = 'Saco kraft (pacote)'), 0.004
union all
select (select id from public.pratos where nome = 'Kong Gibão'), (select id from public.insumos where nome = 'Bacon'), 0.114
union all
select (select id from public.pratos where nome = 'Kong Gibão'), (select id from public.insumos where nome = 'Queijo cheddar'), 0.025
union all
select (select id from public.pratos where nome = 'Kong Gibão'), (select id from public.insumos where nome = 'Cebola crispy'), 1.0
union all
select (select id from public.pratos where nome = 'Rei da Selva (X-Tudo)'), (select id from public.insumos where nome = 'Blend de costela 120g'), 1.0
union all
select (select id from public.pratos where nome = 'Rei da Selva (X-Tudo)'), (select id from public.insumos where nome = 'Pão brioche'), 1.0
union all
select (select id from public.pratos where nome = 'Rei da Selva (X-Tudo)'), (select id from public.insumos where nome = 'Mussarela'), 0.03
union all
select (select id from public.pratos where nome = 'Rei da Selva (X-Tudo)'), (select id from public.insumos where nome = 'Maionese'), 0.006944
union all
select (select id from public.pratos where nome = 'Rei da Selva (X-Tudo)'), (select id from public.insumos where nome = 'Ketchup'), 0.013889
union all
select (select id from public.pratos where nome = 'Rei da Selva (X-Tudo)'), (select id from public.insumos where nome = 'Molho tártaro'), 0.3
union all
select (select id from public.pratos where nome = 'Rei da Selva (X-Tudo)'), (select id from public.insumos where nome = 'Papel acoplado (rolo)'), 0.0004
union all
select (select id from public.pratos where nome = 'Rei da Selva (X-Tudo)'), (select id from public.insumos where nome = 'Saco kraft (pacote)'), 0.004
union all
select (select id from public.pratos where nome = 'Rei da Selva (X-Tudo)'), (select id from public.insumos where nome = 'Ovo'), 1.0
union all
select (select id from public.pratos where nome = 'Rei da Selva (X-Tudo)'), (select id from public.insumos where nome = 'Alface'), 0.02
union all
select (select id from public.pratos where nome = 'Rei da Selva (X-Tudo)'), (select id from public.insumos where nome = 'Bacon'), 0.038
union all
select (select id from public.pratos where nome = 'Rei da Selva (X-Tudo)'), (select id from public.insumos where nome = 'Tomate'), 0.05
union all
select (select id from public.pratos where nome = 'Rei da Selva (X-Tudo)'), (select id from public.insumos where nome = 'Salsicha'), 0.016667
union all
select (select id from public.pratos where nome = 'Rei da Selva (X-Tudo)'), (select id from public.insumos where nome = 'Presunto'), 0.025
union all
select (select id from public.pratos where nome = 'Selva Burguer (X-Salada Especial)'), (select id from public.insumos where nome = 'Blend de costela 120g'), 1.0
union all
select (select id from public.pratos where nome = 'Selva Burguer (X-Salada Especial)'), (select id from public.insumos where nome = 'Pão brioche'), 1.0
union all
select (select id from public.pratos where nome = 'Selva Burguer (X-Salada Especial)'), (select id from public.insumos where nome = 'Mussarela'), 0.03
union all
select (select id from public.pratos where nome = 'Selva Burguer (X-Salada Especial)'), (select id from public.insumos where nome = 'Maionese'), 0.006944
union all
select (select id from public.pratos where nome = 'Selva Burguer (X-Salada Especial)'), (select id from public.insumos where nome = 'Ketchup'), 0.013889
union all
select (select id from public.pratos where nome = 'Selva Burguer (X-Salada Especial)'), (select id from public.insumos where nome = 'Molho tártaro'), 0.3
union all
select (select id from public.pratos where nome = 'Selva Burguer (X-Salada Especial)'), (select id from public.insumos where nome = 'Papel acoplado (rolo)'), 0.0004
union all
select (select id from public.pratos where nome = 'Selva Burguer (X-Salada Especial)'), (select id from public.insumos where nome = 'Saco kraft (pacote)'), 0.004
union all
select (select id from public.pratos where nome = 'Selva Burguer (X-Salada Especial)'), (select id from public.insumos where nome = 'Ovo'), 1.0
union all
select (select id from public.pratos where nome = 'Selva Burguer (X-Salada Especial)'), (select id from public.insumos where nome = 'Alface'), 0.02
union all
select (select id from public.pratos where nome = 'Selva Burguer (X-Salada Especial)'), (select id from public.insumos where nome = 'Tomate'), 0.05
union all
select (select id from public.pratos where nome = 'Mico Dourado (X-Chicken)'), (select id from public.insumos where nome = 'Frango grelhado 120g'), 1.0
union all
select (select id from public.pratos where nome = 'Mico Dourado (X-Chicken)'), (select id from public.insumos where nome = 'Pão brioche'), 1.0
union all
select (select id from public.pratos where nome = 'Mico Dourado (X-Chicken)'), (select id from public.insumos where nome = 'Mussarela'), 0.03
union all
select (select id from public.pratos where nome = 'Mico Dourado (X-Chicken)'), (select id from public.insumos where nome = 'Maionese'), 0.006944
union all
select (select id from public.pratos where nome = 'Mico Dourado (X-Chicken)'), (select id from public.insumos where nome = 'Ketchup'), 0.013889
union all
select (select id from public.pratos where nome = 'Mico Dourado (X-Chicken)'), (select id from public.insumos where nome = 'Molho tártaro'), 0.3
union all
select (select id from public.pratos where nome = 'Mico Dourado (X-Chicken)'), (select id from public.insumos where nome = 'Papel acoplado (rolo)'), 0.0004
union all
select (select id from public.pratos where nome = 'Mico Dourado (X-Chicken)'), (select id from public.insumos where nome = 'Saco kraft (pacote)'), 0.004
union all
select (select id from public.pratos where nome = 'Mico Dourado (X-Chicken)'), (select id from public.insumos where nome = 'Ovo'), 1.0
union all
select (select id from public.pratos where nome = 'Mico Dourado (X-Chicken)'), (select id from public.insumos where nome = 'Alface'), 0.02
union all
select (select id from public.pratos where nome = 'Mico Dourado (X-Chicken)'), (select id from public.insumos where nome = 'Tomate'), 0.05
union all
select (select id from public.pratos where nome = 'Mico Verde (X-Salada de Frango)'), (select id from public.insumos where nome = 'Frango grelhado 120g'), 1.0
union all
select (select id from public.pratos where nome = 'Mico Verde (X-Salada de Frango)'), (select id from public.insumos where nome = 'Pão brioche'), 1.0
union all
select (select id from public.pratos where nome = 'Mico Verde (X-Salada de Frango)'), (select id from public.insumos where nome = 'Mussarela'), 0.03
union all
select (select id from public.pratos where nome = 'Mico Verde (X-Salada de Frango)'), (select id from public.insumos where nome = 'Maionese'), 0.006944
union all
select (select id from public.pratos where nome = 'Mico Verde (X-Salada de Frango)'), (select id from public.insumos where nome = 'Ketchup'), 0.013889
union all
select (select id from public.pratos where nome = 'Mico Verde (X-Salada de Frango)'), (select id from public.insumos where nome = 'Molho tártaro'), 0.3
union all
select (select id from public.pratos where nome = 'Mico Verde (X-Salada de Frango)'), (select id from public.insumos where nome = 'Papel acoplado (rolo)'), 0.0004
union all
select (select id from public.pratos where nome = 'Mico Verde (X-Salada de Frango)'), (select id from public.insumos where nome = 'Saco kraft (pacote)'), 0.004
union all
select (select id from public.pratos where nome = 'Mico Verde (X-Salada de Frango)'), (select id from public.insumos where nome = 'Alface'), 0.02
union all
select (select id from public.pratos where nome = 'Mico Verde (X-Salada de Frango)'), (select id from public.insumos where nome = 'Tomate'), 0.05
union all
select (select id from public.pratos where nome = 'Mico Especial (X-Bacon Especial)'), (select id from public.insumos where nome = 'Blend de costela 120g'), 1.0
union all
select (select id from public.pratos where nome = 'Mico Especial (X-Bacon Especial)'), (select id from public.insumos where nome = 'Pão brioche'), 1.0
union all
select (select id from public.pratos where nome = 'Mico Especial (X-Bacon Especial)'), (select id from public.insumos where nome = 'Mussarela'), 0.03
union all
select (select id from public.pratos where nome = 'Mico Especial (X-Bacon Especial)'), (select id from public.insumos where nome = 'Maionese'), 0.006944
union all
select (select id from public.pratos where nome = 'Mico Especial (X-Bacon Especial)'), (select id from public.insumos where nome = 'Ketchup'), 0.013889
union all
select (select id from public.pratos where nome = 'Mico Especial (X-Bacon Especial)'), (select id from public.insumos where nome = 'Molho tártaro'), 0.3
union all
select (select id from public.pratos where nome = 'Mico Especial (X-Bacon Especial)'), (select id from public.insumos where nome = 'Papel acoplado (rolo)'), 0.0004
union all
select (select id from public.pratos where nome = 'Mico Especial (X-Bacon Especial)'), (select id from public.insumos where nome = 'Saco kraft (pacote)'), 0.004
union all
select (select id from public.pratos where nome = 'Mico Especial (X-Bacon Especial)'), (select id from public.insumos where nome = 'Ovo'), 1.0
union all
select (select id from public.pratos where nome = 'Mico Especial (X-Bacon Especial)'), (select id from public.insumos where nome = 'Alface'), 0.02
union all
select (select id from public.pratos where nome = 'Mico Especial (X-Bacon Especial)'), (select id from public.insumos where nome = 'Bacon'), 0.038
union all
select (select id from public.pratos where nome = 'Mico Especial (X-Bacon Especial)'), (select id from public.insumos where nome = 'Tomate'), 0.05
union all
select (select id from public.pratos where nome = 'Kongzilla'), (select id from public.insumos where nome = 'Blend de costela 180g'), 3.0
union all
select (select id from public.pratos where nome = 'Kongzilla'), (select id from public.insumos where nome = 'Pão brioche'), 1.0
union all
select (select id from public.pratos where nome = 'Kongzilla'), (select id from public.insumos where nome = 'Maionese'), 0.006944
union all
select (select id from public.pratos where nome = 'Kongzilla'), (select id from public.insumos where nome = 'Ketchup'), 0.013889
union all
select (select id from public.pratos where nome = 'Kongzilla'), (select id from public.insumos where nome = 'Molho tártaro'), 0.3
union all
select (select id from public.pratos where nome = 'Kongzilla'), (select id from public.insumos where nome = 'Papel acoplado (rolo)'), 0.0004
union all
select (select id from public.pratos where nome = 'Kongzilla'), (select id from public.insumos where nome = 'Saco kraft (pacote)'), 0.004
union all
select (select id from public.pratos where nome = 'Kongzilla'), (select id from public.insumos where nome = 'Queijo empanado especial'), 0.1
union all
select (select id from public.pratos where nome = 'Kongzilla'), (select id from public.insumos where nome = 'Alface'), 0.02
union all
select (select id from public.pratos where nome = 'Kongzilla'), (select id from public.insumos where nome = 'Bacon'), 0.076
union all
select (select id from public.pratos where nome = 'Kongzilla'), (select id from public.insumos where nome = 'Tomate'), 0.05
on conflict (prato_id, insumo_id) do update set quantidade = excluded.quantidade;