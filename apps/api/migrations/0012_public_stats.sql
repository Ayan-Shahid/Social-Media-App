-- Real numbers for the public landing page. Aggregates only: no names, no ids, nothing per person.
-- SECURITY DEFINER because anonymous visitors can't read these tables under RLS.
CREATE OR REPLACE FUNCTION app.public_stats()
RETURNS TABLE (people int, posts int, shorts int, stories_today int, live_now int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT (SELECT count(*)::int FROM users),
         (SELECT count(*)::int FROM posts WHERE kind = 'post'),
         (SELECT count(*)::int FROM posts WHERE kind = 'short'),
         (SELECT count(*)::int FROM stories WHERE expires_at > now()),
         (SELECT count(*)::int FROM live_streams WHERE status = 'live')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.public_stats() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.public_stats() TO glimpse_app;
