-- ============================================================================
-- Desactivar la economía (monedas, tienda y cosméticos) SIN borrar datos.
-- No se ejecuta nunca solo: solo si se decide retirarla temporalmente.
--
-- Después de ejecutarlo:
--   * Las partidas siguen funcionando igual, pero ya no pagan monedas.
--   * La tienda y «Mis cartas» de la app muestran un error de carga (no hay funciones).
--   * Saldos, compras y movimientos se conservan intactos en sus tablas.
-- Para volver a activarla: ejecutar otra vez supabase/migrations/20261019000000_unisono.sql.
--
-- (No se borran tablas ni columnas: la foto de la partida y el inicio de partida las leen.)
-- ============================================================================

-- Terminar una partida ya no paga (end_game llama a esta función).
create or replace function game_private.grant_match_rewards(p_match bigint, p_room uuid, p_completed int, p_won boolean)
returns void language plpgsql set search_path = ''
as $$ begin end; $$;

-- Sin API de la tienda: nadie puede comprar ni equipar.
drop function if exists public.get_my_profile();
drop function if exists public.buy_cosmetic(text);
drop function if exists public.equip_cosmetic(text);
drop function if exists public.get_my_coin_history();
