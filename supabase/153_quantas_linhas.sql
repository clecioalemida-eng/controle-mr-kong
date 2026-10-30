-- ===========================================================================
-- 153 — Quantas linhas a tela deveria estar lendo
--
-- A tela mostrava "custo sem ficha" em pratos que TÊM ficha (Rei da Selva,
-- com 14 ingredientes, era um deles). A causa não estava na ficha: o
-- Supabase devolve no máximo "Max rows" por requisição — 1000, por padrão
-- — e .limit() não passa por cima disso, só pede menos.
--
-- Se prato_insumos tem mais de 1000 linhas, a consulta trazia o começo e
-- calava o resto, sem erro nenhum. Os pratos que sobravam ficavam com
-- custo zero e entravam no lucro como se não custassem nada.
--
-- Esta consulta mede o buraco. Se total_linhas > 1000, era isso.
-- Só lê. Não escreve nada.
-- ===========================================================================

select (select count(*) from public.prato_insumos)                       as total_linhas,
       (select count(distinct prato_id) from public.prato_insumos)       as pratos_com_ficha,
       (select count(*) from public.pratos where coalesce(ativo,true))   as pratos_ativos,
       1000                                                              as teto_por_requisicao,
       case when (select count(*) from public.prato_insumos) > 1000
            then 'SIM — a tela estava lendo só uma parte'
            else 'não — o problema é outro' end                          as era_o_corte;
