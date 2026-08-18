-- Execute depois do 008_insumos_compostos.sql.

-- 1) A "Mussarela" que já estava cadastrada (R$43,99/kg, usada nas 14
-- fichas técnicas dos hambúrgueres) é a fatiada — só renomeia, sem mexer
-- em custo nem nas fichas técnicas que já usam ela.
update public.insumos set nome = 'Mussarela fatiada' where lower(nome) = 'mussarela';

-- 2) Mussarela em barra é um insumo diferente, ainda sem custo definido —
-- preencher pelo lápis de edição quando tiver o preço.
insert into public.insumos (nome, unidade, custo_medio_atual)
values ('Mussarela em barra', 'kg', 0)
on conflict (lower(nome)) do nothing;

-- 3) Molho gourmet ("kongnese"): insumo COMPOSTO — ainda sem composição
-- cadastrada (custo fica 0 até alguém montar a receita dele pelo app).
insert into public.insumos (nome, unidade, custo_medio_atual, composto)
values ('Molho gourmet', 'ml', 0, true)
on conflict (lower(nome)) do nothing;

-- 4) Liga 30ml de molho gourmet aos 8 hambúrgueres da linha gourmet cuja
-- descrição no cardápio cita "kongnese" (o Sagui-pigmeu, versão infantil,
-- não leva).
insert into public.prato_insumos (prato_id, insumo_id, quantidade)
select p.id, (select id from public.insumos where nome = 'Molho gourmet'), 30
  from public.pratos p
 where p.nome in (
   'Colobus', 'Kong Dril', 'Kong Uacari', 'Kong Orangotango-de-Bornéu (Clássico)',
   'Kong Langur', 'King Kong', 'Kong Gibão', 'Kongzilla'
 )
on conflict (prato_id, insumo_id) do update set quantidade = excluded.quantidade;
