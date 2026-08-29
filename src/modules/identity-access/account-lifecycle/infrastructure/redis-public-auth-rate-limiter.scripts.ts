import type { RedisScriptDefinition } from '@/platform/redis/redis-script.runner'

export const PUBLIC_AUTH_RATE_LIMIT_SCRIPT: RedisScriptDefinition =
  Object.freeze({
    name: 'auth-public-rate-limit-v1',
    source: `
local ip_count = tonumber(redis.call('GET', KEYS[1]) or '0')
local account_count = tonumber(redis.call('GET', KEYS[2]) or '0')
local ip_ttl = redis.call('PTTL', KEYS[1])
local account_ttl = redis.call('PTTL', KEYS[2])
local cooldown_ttl = redis.call('PTTL', KEYS[3])
local ip_limit = tonumber(ARGV[1])
local account_limit = tonumber(ARGV[2])
local window_ms = tonumber(ARGV[3])
local cooldown_ms = tonumber(ARGV[4])
local retry_after = 0
if ip_count >= ip_limit then retry_after = math.max(retry_after, ip_ttl) end
if account_count >= account_limit then retry_after = math.max(retry_after, account_ttl) end
if cooldown_ms > 0 and cooldown_ttl >= 0 then retry_after = math.max(retry_after, cooldown_ttl) end
if ip_count >= ip_limit or account_count >= account_limit or (cooldown_ms > 0 and cooldown_ttl >= 0) then
  if retry_after < 1 then retry_after = window_ms end
  return {0, retry_after}
end
ip_count = redis.call('INCR', KEYS[1])
account_count = redis.call('INCR', KEYS[2])
if ip_count == 1 then redis.call('PEXPIRE', KEYS[1], window_ms) end
if account_count == 1 then redis.call('PEXPIRE', KEYS[2], window_ms) end
if cooldown_ms > 0 then redis.call('SET', KEYS[3], '1', 'PX', cooldown_ms) end
return {1, 0}
`,
  })
