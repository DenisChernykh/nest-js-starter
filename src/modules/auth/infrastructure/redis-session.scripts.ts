import type { RedisScriptDefinition } from '@/platform/redis/redis-script.runner'

/** Atomic creation of one session record and its user-owned public-ID index. */
export const CREATE_SESSION_SCRIPT: RedisScriptDefinition = Object.freeze({
  name: 'auth-session-create-v1',
  source: `
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[3])
redis.call('HSET', KEYS[2], ARGV[2], ARGV[4])
local current_ttl = redis.call('PTTL', KEYS[2])
local desired_ttl = tonumber(ARGV[5])
if current_ttl < desired_ttl then
  redis.call('PEXPIRE', KEYS[2], desired_ttl)
end
return 1
`,
})

/** Atomic bounded touch that cannot resurrect a revoked or expired session. */
export const TOUCH_SESSION_SCRIPT: RedisScriptDefinition = Object.freeze({
  name: 'auth-session-touch-v1',
  source: `
local payload = redis.call('GET', KEYS[1])
if not payload then return false end
local decoded = cjson.decode(payload)
local now_ms = tonumber(ARGV[1])
local absolute_ms = tonumber(decoded.absoluteExpiresAtMs)
if absolute_ms <= now_ms then
  redis.call('DEL', KEYS[1])
  redis.call('HDEL', KEYS[2], ARGV[4])
  return false
end
if now_ms - tonumber(decoded.lastSeenAtMs) >= tonumber(ARGV[3]) then
  decoded.lastSeenAtMs = now_ms
  local ttl_ms = math.min(tonumber(ARGV[2]), absolute_ms - now_ms)
  payload = cjson.encode(decoded)
  redis.call('SET', KEYS[1], payload, 'PX', ttl_ms)
end
return payload
`,
})

/** Atomic ownership-checked revocation of one public session identifier. */
export const REVOKE_SESSION_SCRIPT: RedisScriptDefinition = Object.freeze({
  name: 'auth-session-revoke-one-v1',
  source: `
local digest = redis.call('HGET', KEYS[2], ARGV[1])
if not digest or digest ~= ARGV[3] then return 0 end
local payload = redis.call('GET', KEYS[1])
if payload then
  local decoded = cjson.decode(payload)
  if decoded.userId ~= ARGV[2] then return 0 end
end
redis.call('DEL', KEYS[1])
redis.call('HDEL', KEYS[2], ARGV[1])
return 1
`,
})

/** Atomic exact-key revocation for one previously read user index snapshot. */
export const REVOKE_ALL_SESSIONS_SCRIPT: RedisScriptDefinition = Object.freeze({
  name: 'auth-session-revoke-all-v1',
  source: `
local deleted = 0
for index = 2, #KEYS do
  local argument = (index - 2) * 2 + 1
  local public_id = ARGV[argument]
  local digest = ARGV[argument + 1]
  if redis.call('HGET', KEYS[1], public_id) == digest then
    redis.call('DEL', KEYS[index])
    redis.call('HDEL', KEYS[1], public_id)
    deleted = deleted + 1
  end
end
if redis.call('HLEN', KEYS[1]) == 0 then redis.call('DEL', KEYS[1]) end
return deleted
`,
})

/** Complete reviewed session-script registration set. */
export const REDIS_SESSION_SCRIPTS: readonly RedisScriptDefinition[] =
  Object.freeze([
    CREATE_SESSION_SCRIPT,
    TOUCH_SESSION_SCRIPT,
    REVOKE_SESSION_SCRIPT,
    REVOKE_ALL_SESSIONS_SCRIPT,
  ])
