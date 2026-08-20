-- Execute depois do 026_fornecedores_e_compras.sql.
-- Os itens do Checklist Operacional eram fixos no código — agora vivem
-- no banco, editáveis por administrador (editar, excluir, acrescentar).
-- Essa migração cria a tabela e semeia com os itens que já existiam.

create table if not exists public.checklist_itens (
  id uuid primary key default gen_random_uuid(),
  departamento text not null check (departamento in ('caixa', 'bar', 'chapa', 'gerencia')),
  turno text not null check (turno in ('abertura', 'fechamento')),
  texto text not null,
  ordem integer not null default 0,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

alter table public.checklist_itens enable row level security;

drop policy if exists "aprovados leem checklist_itens" on public.checklist_itens;
create policy "aprovados leem checklist_itens" on public.checklist_itens for select using (public.esta_aprovado());
drop policy if exists "so admin insere checklist_itens" on public.checklist_itens;
create policy "so admin insere checklist_itens" on public.checklist_itens for insert with check (public.is_admin());
drop policy if exists "so admin atualiza checklist_itens" on public.checklist_itens;
create policy "so admin atualiza checklist_itens" on public.checklist_itens for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "so admin apaga checklist_itens" on public.checklist_itens;
create policy "so admin apaga checklist_itens" on public.checklist_itens for delete using (public.is_admin());

-- Semeadura: só roda se a tabela estiver vazia, pra não duplicar caso
-- essa migração seja executada mais de uma vez.
do $$
begin
  if not exists (select 1 from public.checklist_itens limit 1) then

    insert into public.checklist_itens (departamento, turno, texto, ordem) values
      ('caixa','abertura','Contar caixa inicial',0),
      ('caixa','abertura','Conferir troco',1),
      ('caixa','abertura','Ligar sistema de vendas (PDV)',2),
      ('caixa','abertura','Testar impressora de cupom',3),
      ('caixa','abertura','Verificar maquininha de cartão',4),
      ('caixa','abertura','Conferir conexão com internet',5),
      ('caixa','abertura','Organizar bancada do caixa',6),
      ('caixa','abertura','Conferir bobinas de cupom fiscal',7),
      ('caixa','abertura','Ligar ar-condicionado do salão',8),
      ('caixa','abertura','Verificar iluminação do salão',9),
      ('caixa','abertura','Conferir cardápios disponíveis',10),
      ('caixa','abertura','Testar comunicação com a cozinha',11),
      ('caixa','abertura','Verificar limpeza do caixa',12),
      ('caixa','abertura','Ligar som',13),

      ('caixa','fechamento','Contar caixa final',0),
      ('caixa','fechamento','Conferir sangria do dia',1),
      ('caixa','fechamento','Emitir relatório de vendas',2),
      ('caixa','fechamento','Desligar sistema de vendas (PDV)',3),
      ('caixa','fechamento','Separar troco para o dia seguinte',4),
      ('caixa','fechamento','Conferir diferenças de caixa',5),
      ('caixa','fechamento','Organizar comprovantes e cupons',6),
      ('caixa','fechamento','Desligar impressora de cupom',7),
      ('caixa','fechamento','Trancar gaveta do caixa',8),
      ('caixa','fechamento','Desligar som',9),
      ('caixa','fechamento','Desligar ar-condicionado',10),
      ('caixa','fechamento','Verificar limpeza final do caixa',11),

      ('bar','abertura','Conferir estoque de bebidas',0),
      ('bar','abertura','Verificar validade dos insumos',1),
      ('bar','abertura','Organizar bancada do bar',2),
      ('bar','abertura','Testar máquina de gelo',3),
      ('bar','abertura','Conferir taças e copos limpos',4),
      ('bar','abertura','Verificar temperatura das geladeiras',5),
      ('bar','abertura','Preparar guarnições e frutas',6),
      ('bar','abertura','Conferir cardápio de drinks',7),
      ('bar','abertura','Testar liquidificador',8),
      ('bar','abertura','Organizar utensílios do bar',9),
      ('bar','abertura','Repor gelo',10),
      ('bar','abertura','Verificar limpeza do bar',11),

      ('bar','fechamento','Conferir estoque final de bebidas',0),
      ('bar','fechamento','Guardar bebidas abertas',1),
      ('bar','fechamento','Limpar bancada do bar',2),
      ('bar','fechamento','Lavar utensílios utilizados',3),
      ('bar','fechamento','Desligar máquina de gelo',4),
      ('bar','fechamento','Registrar perdas e quebras',5),
      ('bar','fechamento','Conferir consumo interno',6),
      ('bar','fechamento','Organizar geladeiras',7),
      ('bar','fechamento','Retirar lixo do bar',8),
      ('bar','fechamento','Trancar armários de bebidas',9),
      ('bar','fechamento','Verificar limpeza geral do bar',10),

      ('chapa','abertura','Ligar chapa',0),
      ('chapa','abertura','Verificar temperatura da chapa',1),
      ('chapa','abertura','Conferir estoque de carnes',2),
      ('chapa','abertura','Conferir estoque de pães',3),
      ('chapa','abertura','Organizar bancada da chapa',4),
      ('chapa','abertura','Verificar validade dos insumos',5),
      ('chapa','abertura','Testar exaustor',6),
      ('chapa','abertura','Conferir utensílios de corte',7),
      ('chapa','abertura','Verificar limpeza da chapa',8),
      ('chapa','abertura','Conferir molhos e temperos',9),
      ('chapa','abertura','Verificar uso de EPIs',10),

      ('chapa','fechamento','Desligar chapa',0),
      ('chapa','fechamento','Limpar superfície da chapa',1),
      ('chapa','fechamento','Guardar insumos restantes',2),
      ('chapa','fechamento','Conferir sobras do dia',3),
      ('chapa','fechamento','Registrar perdas',4),
      ('chapa','fechamento','Limpar bancada',5),
      ('chapa','fechamento','Lavar utensílios',6),
      ('chapa','fechamento','Desligar exaustor',7),
      ('chapa','fechamento','Retirar lixo',8),
      ('chapa','fechamento','Verificar limpeza geral',9),

      ('gerencia','abertura','Conferir escala do dia',0),
      ('gerencia','abertura','Verificar caixa inicial de todos os setores',1),
      ('gerencia','abertura','Conferir estoque geral',2),
      ('gerencia','abertura','Verificar equipe presente',3),
      ('gerencia','abertura','Revisar pendências do dia anterior',4),

      ('gerencia','fechamento','Conferir fechamento de todos os setores',0),
      ('gerencia','fechamento','Revisar relatório de vendas do dia',1),
      ('gerencia','fechamento','Conferir não conformidades registradas',2),
      ('gerencia','fechamento','Planejar pendências para o dia seguinte',3),
      ('gerencia','fechamento','Trancar estabelecimento',4);

  end if;
end $$;
