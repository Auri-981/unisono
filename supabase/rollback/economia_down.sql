-- ============================================================================
-- Desactivar la economía (monedas, tienda, cosméticos, títulos y logros) SIN borrar datos.
-- No se ejecuta nunca solo: solo si se decide retirarla temporalmente.
--
-- Después de ejecutarlo:
--   * Las partidas siguen funcionando igual, pero ya no pagan monedas ni cuentan para los logros.
--   * La tienda, la colección y los logros de la app muestran un error de carga (no hay funciones).
--   * Saldos, compras, estadísticas, logros y movimientos se conservan intactos en sus tablas.
-- Para volver a activarla: ejecutar otra vez supabase/migrations/20261019000000_unisono.sql.
--
-- (No se borran tablas ni columnas: la foto de la partida y el inicio de partida las leen.)
-- ============================================================================

-- Terminar una partida ya no paga (end_game llama a esta función).
create or replace function game_private.grant_match_rewards(p_match bigint, p_room uuid, p_completed int, p_won boolean)
returns void language plpgsql set search_path = ''
as $$ begin end; $$;

-- Los niveles y las partidas dejan de contar para las estadísticas y los logros.
create or replace function game_private.record_level_done(p_room uuid)
returns void language plpgsql set search_path = ''
as $$ begin end; $$;
create or replace function game_private.record_match_progress(p_match bigint, p_room uuid, p_won boolean)
returns void language plpgsql set search_path = ''
as $$ begin end; $$;

-- Sin API de la tienda ni de los logros: nadie puede comprar, equipar ni marcar avisos.
drop function if exists public.get_my_profile();
drop function if exists public.buy_cosmetic(text);
drop function if exists public.equip_cosmetic(text);
drop function if exists public.unequip_cosmetic(text);
drop function if exists public.mark_achievements_seen(text[]);
drop function if exists public.get_my_coin_history();
