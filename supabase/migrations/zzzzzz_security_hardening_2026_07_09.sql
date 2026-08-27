-- ============================================================
-- SECURITY HARDENING — 2026-07-09 audit remediation
--
-- Sorts AFTER every existing migration (6 'z' prefix beats the max
-- existing 'zzzzz_' files) so these definitions win the alphabetical
-- apply order and cannot be silently reverted by an earlier file.
--
-- Findings addressed (audit doc removed 2026-08-27; see git history):
--   C-1  Unbounded RTC minting via free-text skill_progress -> earn_skill.
--        (a) mastery trigger now only pays for REAL curriculum nodes.
--        (b) process_rtc_transaction rate-limits earn_skill to 200 RTC/24h.
--   H-11 award_skill_gauntlet_rtc() — a system-granted path for legit
--        gauntlet awards (the direct student earn_skill call is rejected
--        by the hardened RPC, so the gauntlet paid 0). Rate-limited.
--   C-3  notifications INSERT policy tightened: students may only notify
--        themselves; teachers/admins may notify anyone (broadcasts).
--   H-9  admin_bank_list_students() masks games_pin for non-admins.
--   Repo-integrity: student_notes admin policy referenced a nonexistent
--        `profiles.role`; corrected to user_profiles/user_type. Also
--        re-ensures math_dojo_sessions.subject exists for fresh deploys.
--
-- SAFETY: does NOT touch protect_user_profile_columns (must stay SECURITY
-- INVOKER). Every SECURITY DEFINER function pins
-- SET search_path = '' and schema-qualifies objects. All statements are
-- idempotent (CREATE OR REPLACE / DROP POLICY IF EXISTS + CREATE).
-- ============================================================


-- ============================================================
-- C-1 (a): Mastery trigger only awards for real curriculum nodes.
--
-- Copies the current canonical body (rtc_skill_mastery_lower_to_5.sql —
-- 5 RTC on first transition INTO 'mastered') and ADDS a curriculum-node
-- validation gate. A student can still INSERT arbitrary free-text
-- skill_progress rows and drive them to 'mastered' (the row is allowed),
-- but no RTC is minted unless the skill maps to a real curriculum_nodes
-- entry — by node_id, or by the legacy_subject/legacy_name bridge that
-- skill_progress_node_id.sql / skill_progress_with_graph use. This kills
-- the free-text forge while preserving the legitimate 5-RTC-on-first-
-- mastery flow for every real Math Dojo / English Lyceum / etc. skill,
-- which all carry matching curriculum_nodes.legacy_* values.
-- ============================================================
CREATE OR REPLACE FUNCTION public.rtc_skill_mastery_reward()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result JSON;
BEGIN
  -- Only fire on first transition INTO 'mastered' (from any other state).
  IF NEW.state = 'mastered' AND (OLD.state IS DISTINCT FROM 'mastered') THEN
    -- C-1(a): validate the mastered skill against the real curriculum.
    -- Match either the bridged node_id or the legacy subject+name mapping.
    IF EXISTS (
      SELECT 1 FROM public.curriculum_nodes cn
      WHERE (NEW.node_id IS NOT NULL AND cn.id = NEW.node_id)
         OR (cn.legacy_subject = NEW.subject AND cn.legacy_name = NEW.skill_name)
    ) THEN
      SELECT public.process_rtc_transaction(
        p_user_id := NEW.user_id,
        p_amount := 5,
        p_transaction_type := 'earn_skill',
        p_description := 'Skill mastery: ' || COALESCE(NEW.skill_name, 'Unknown skill'),
        p_reference_id := NEW.id::TEXT,
        p_reference_type := 'skill_progress'
      ) INTO v_result;
    END IF;
    -- No matching curriculum node: row is still allowed, but no RTC minted.
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger definition unchanged; restate idempotently so a fresh deploy
-- that never ran the original still wires it up.
DROP TRIGGER IF EXISTS trigger_rtc_skill_mastery ON public.skill_progress;
CREATE TRIGGER trigger_rtc_skill_mastery
  AFTER UPDATE ON public.skill_progress
  FOR EACH ROW
  EXECUTE FUNCTION public.rtc_skill_mastery_reward();


-- ============================================================
-- C-1 (b): Rate-limit earn_skill inside process_rtc_transaction.
--
-- Full current body copied verbatim from
-- zz_harden_rtc_transaction_forge_vectors.sql — every existing sign
-- check, per-call cap, role/auth gate, earn_arcade rate limit, split-id
-- handling, duplicate protection and negative-balance guard is preserved.
-- The ONLY addition is the earn_skill 24h rolling cap block (mirrors the
-- earn_arcade limiter), plus the v_recent_skill declaration.
--
-- Cap chosen: 200 RTC / 24h from earn_skill for non-staff callers.
--   * A legitimate first-mastery pays 5 RTC, so 200/24h allows ~40
--     brand-new real-curriculum masteries per day plus gauntlet/retention
--     awards — comfortably above any honest learner's daily rate.
--   * Combined with C-1(a) (which already kills the free-text forge),
--     this is defense-in-depth: even forging via real node names caps out
--     at 200/day, making the exploit pointless.
--   * Teachers/admins granting on-behalf are exempt (they passed the role
--     gate above), exactly like the earn_arcade limiter.
-- ============================================================
CREATE OR REPLACE FUNCTION public.process_rtc_transaction(
  p_user_id UUID,
  p_amount INTEGER,
  p_transaction_type TEXT,
  p_description TEXT DEFAULT NULL,
  p_reference_id TEXT DEFAULT NULL,
  p_reference_type TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_current_balance INTEGER;
  v_new_balance INTEGER;
  v_transaction_id UUID;
  v_caller_type TEXT;
  v_actual_created_by UUID;
  v_caller_profile_id UUID;
  v_recent_arcade INTEGER;
  v_recent_skill INTEGER;
  v_is_self BOOLEAN;
BEGIN
  -- Validate transaction type. Bank/privilege types go through their
  -- own dedicated RPCs and are intentionally excluded here.
  IF p_transaction_type NOT IN (
    'earn_manual', 'earn_skill', 'earn_assignment', 'earn_arcade',
    'spend_cosmetic', 'spend_reward', 'admin_adjustment'
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Invalid transaction type');
  END IF;

  -- === SIGN AND AMOUNT-CAP CHECKS ===

  IF p_transaction_type LIKE 'earn\_%' ESCAPE '\' AND p_amount <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'Earn transactions require a positive amount');
  END IF;

  IF p_transaction_type LIKE 'spend\_%' ESCAPE '\' AND p_amount >= 0 THEN
    RETURN json_build_object('success', false, 'error', 'Spend transactions require a negative amount');
  END IF;

  -- Per-call cap on earn_arcade. Legit max reward is 15 (ranked win).
  IF p_transaction_type = 'earn_arcade' AND p_amount > 20 THEN
    RETURN json_build_object('success', false, 'error', 'earn_arcade amount exceeds per-call cap');
  END IF;

  -- === RESOLVE CALLER ===
  v_actual_created_by := COALESCE(auth.uid(), p_created_by);
  v_caller_type := public.get_my_user_type();

  SELECT id INTO v_caller_profile_id
  FROM public.user_profiles
  WHERE auth_user_id = auth.uid();

  -- "Is p_user_id the caller themselves?" — accept either their profile id
  -- or their auth.uid() to tolerate split-id accounts.
  v_is_self := (p_user_id = v_caller_profile_id OR p_user_id = auth.uid());

  -- === AUTHORIZATION ===

  IF p_transaction_type = 'admin_adjustment' THEN
    IF v_caller_type IS DISTINCT FROM 'admin' THEN
      RETURN json_build_object('success', false, 'error', 'Only admins can make admin adjustments');
    END IF;

  ELSIF p_transaction_type = 'earn_manual' THEN
    IF v_caller_type NOT IN ('teacher', 'admin') THEN
      RETURN json_build_object('success', false, 'error', 'Only teachers/admins can award manual RTC');
    END IF;

  ELSIF p_transaction_type IN ('earn_skill', 'earn_assignment') THEN
    -- Only the skill/assignment triggers or teacher/admin may grant these.
    IF pg_trigger_depth() = 0
       AND (v_caller_type IS NULL OR v_caller_type NOT IN ('teacher', 'admin')) THEN
      RETURN json_build_object('success', false, 'error', 'Skill/assignment rewards are system-granted only');
    END IF;

  ELSIF p_transaction_type IN ('earn_arcade', 'spend_cosmetic', 'spend_reward') THEN
    -- Own-account by default, OR teacher/admin acting on a student.
    IF NOT v_is_self AND v_caller_type NOT IN ('teacher', 'admin') THEN
      RETURN json_build_object(
        'success', false,
        'error', 'Arcade/spend transactions must be for your own account'
      );
    END IF;
  END IF;

  -- === RATE LIMIT: earn_arcade (self only) ===
  -- Prevents a console forger from spamming the 20-RTC-per-call mint.
  -- Teachers/admins granting arcade RTC on behalf of a student are
  -- exempt because they've already passed the role check above.
  IF p_transaction_type = 'earn_arcade'
     AND v_caller_type NOT IN ('teacher', 'admin') THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_recent_arcade
    FROM public.rtc_transactions
    WHERE user_id = p_user_id
      AND transaction_type = 'earn_arcade'
      AND created_at > now() - interval '5 minutes';

    IF v_recent_arcade + p_amount > 100 THEN
      RETURN json_build_object(
        'success', false,
        'error', 'Arcade earnings are rate-limited (100 RTC per 5 minutes)'
      );
    END IF;
  END IF;

  -- === RATE LIMIT: earn_skill (self only) — C-1(b) ===
  -- Closes the unbounded skill-mastery / gauntlet mint. 200 RTC/24h is
  -- well above any honest learner (first-mastery = 5 RTC each) yet makes
  -- forging pointless. Staff granting on-behalf are exempt (role-gated
  -- above). NULL caller_type (unauthenticated edge) is treated as non-staff
  -- and therefore rate-limited. Trigger-driven awards run as the student,
  -- so they are correctly counted here too.
  IF p_transaction_type = 'earn_skill'
     AND (v_caller_type IS NULL OR v_caller_type NOT IN ('teacher', 'admin')) THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_recent_skill
    FROM public.rtc_transactions
    WHERE user_id = p_user_id
      AND transaction_type = 'earn_skill'
      AND created_at > now() - interval '24 hours';

    IF v_recent_skill + p_amount > 200 THEN
      RETURN json_build_object(
        'success', false,
        'error', 'Skill earnings are rate-limited (200 RTC per 24 hours)'
      );
    END IF;
  END IF;

  -- === DUPLICATE-REWARD PROTECTION ===
  IF p_reference_id IS NOT NULL AND p_reference_type IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.rtc_transactions
      WHERE user_id = p_user_id
        AND reference_id = p_reference_id
        AND reference_type = p_reference_type
    ) THEN
      RETURN json_build_object('success', false, 'error', 'Duplicate transaction: reward already granted');
    END IF;
  END IF;

  -- === APPLY THE TRANSACTION ===
  SELECT rtc_balance INTO v_current_balance
  FROM public.user_profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'User not found');
  END IF;

  v_new_balance := v_current_balance + p_amount;

  IF v_new_balance < 0 AND p_transaction_type != 'admin_adjustment' THEN
    RETURN json_build_object('success', false, 'error', 'Insufficient balance');
  END IF;

  IF v_new_balance < 0 THEN
    v_new_balance := 0;
  END IF;

  UPDATE public.user_profiles
  SET rtc_balance = v_new_balance
  WHERE id = p_user_id;

  INSERT INTO public.rtc_transactions (
    user_id, amount, transaction_type, description,
    reference_id, reference_type, balance_after, created_by
  ) VALUES (
    p_user_id, p_amount, p_transaction_type, p_description,
    p_reference_id, p_reference_type, v_new_balance, v_actual_created_by
  ) RETURNING id INTO v_transaction_id;

  RETURN json_build_object(
    'success', true,
    'transaction_id', v_transaction_id,
    'new_balance', v_new_balance
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_rtc_transaction TO authenticated;


-- ============================================================
-- H-11: award_skill_gauntlet_rtc(p_skill_count) — system-granted
-- gauntlet award path.
--
-- The frontend previously called process_rtc_transaction('earn_skill', …)
-- directly from a student session; the hardened RPC rejects that
-- (pg_trigger_depth()=0 AND caller is a student -> "system-granted only"),
-- so students earned 0 RTC for completing a gauntlet. This RPC is the
-- sanctioned path: SECURITY DEFINER (owner = postgres) so the SECURITY
-- INVOKER protect_user_profile_columns trigger takes its bypass branch —
-- identical to how process_rtc_transaction is allowed to move the wallet.
--
-- It does NOT route through process_rtc_transaction (that would hit the
-- student gate); it applies the balance update + earn_skill ledger row
-- directly, but reuses the SAME 200 RTC/24h earn_skill cap from C-1(b),
-- plus a dedicated 50 RTC/24h gauntlet cap, so it can't be looped for
-- unbounded RTC. Returns the actual amount awarded (0 if capped/no profile).
-- Frontend: supabase.rpc('award_skill_gauntlet_rtc', { p_skill_count }).
-- ============================================================
CREATE OR REPLACE FUNCTION public.award_skill_gauntlet_rtc(p_skill_count INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id      UUID;
  v_count           INTEGER;
  v_amount          INTEGER;
  v_recent_skill    INTEGER;
  v_recent_gauntlet INTEGER;
  v_current_balance INTEGER;
  v_new_balance     INTEGER;
  v_ref_id          TEXT;
  -- Per-skill rate: 1 RTC per skill defended. Modest by design
  -- (first-mastery pays 5, assignments ~30, arcade up to 15).
  c_per_skill       CONSTANT INTEGER := 1;
  -- 24h earn_skill cap shared with C-1(b) — mastery + gauntlet all count.
  c_skill_24h_cap   CONSTANT INTEGER := 200;
  -- Dedicated per-day gauntlet ceiling so the RPC alone can't be looped.
  c_gauntlet_24h_cap CONSTANT INTEGER := 50;
BEGIN
  -- Resolve the caller's student profile via auth_user_id (split-id safe).
  SELECT id INTO v_profile_id
  FROM public.user_profiles
  WHERE auth_user_id = auth.uid()
  LIMIT 1;

  IF v_profile_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Clamp skill count to a sane non-negative bound (0..50).
  v_count := LEAST(GREATEST(COALESCE(p_skill_count, 0), 0), 50);
  IF v_count = 0 THEN
    RETURN 0;
  END IF;

  v_amount := v_count * c_per_skill;

  -- Dedicated 24h gauntlet cap.
  SELECT COALESCE(SUM(amount), 0) INTO v_recent_gauntlet
  FROM public.rtc_transactions
  WHERE user_id = v_profile_id
    AND transaction_type = 'earn_skill'
    AND reference_type = 'skill_gauntlet'
    AND created_at > now() - interval '24 hours';

  IF v_recent_gauntlet >= c_gauntlet_24h_cap THEN
    RETURN 0;
  END IF;
  IF v_recent_gauntlet + v_amount > c_gauntlet_24h_cap THEN
    v_amount := c_gauntlet_24h_cap - v_recent_gauntlet;
  END IF;

  -- Shared 24h earn_skill cap (mirrors the C-1(b) limiter).
  SELECT COALESCE(SUM(amount), 0) INTO v_recent_skill
  FROM public.rtc_transactions
  WHERE user_id = v_profile_id
    AND transaction_type = 'earn_skill'
    AND created_at > now() - interval '24 hours';

  IF v_recent_skill >= c_skill_24h_cap THEN
    RETURN 0;
  END IF;
  IF v_recent_skill + v_amount > c_skill_24h_cap THEN
    v_amount := c_skill_24h_cap - v_recent_skill;
  END IF;

  IF v_amount <= 0 THEN
    RETURN 0;
  END IF;

  -- Apply. SECURITY DEFINER context => protect_user_profile_columns sees
  -- current_user = function owner and takes its bypass branch.
  SELECT rtc_balance INTO v_current_balance
  FROM public.user_profiles
  WHERE id = v_profile_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  v_new_balance := v_current_balance + v_amount;

  UPDATE public.user_profiles
  SET rtc_balance = v_new_balance
  WHERE id = v_profile_id;

  -- Unique ref (random suffix) so repeated same-second awards never collide
  -- with any duplicate-protection check.
  v_ref_id := 'gauntlet:' || v_profile_id::TEXT || ':' || gen_random_uuid()::TEXT;

  INSERT INTO public.rtc_transactions (
    user_id, amount, transaction_type, description,
    reference_id, reference_type, balance_after, created_by
  ) VALUES (
    v_profile_id, v_amount, 'earn_skill',
    'Skill gauntlet: defended ' || v_count || ' skill(s)',
    v_ref_id, 'skill_gauntlet', v_new_balance, v_profile_id
  );

  RETURN v_amount;

EXCEPTION
  WHEN OTHERS THEN
    RETURN 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.award_skill_gauntlet_rtc(INTEGER) TO authenticated;


-- ============================================================
-- C-3: Tighten the notifications INSERT policy.
--
-- The old policy allowed ANY authenticated user to write a notification
-- targeting ANY user_id (enabling cross-user notification/XSS injection).
-- New rule: students/parents may only insert notifications for their OWN
-- profile (auth.uid() or their split-id profile id); teachers/admins may
-- insert for anyone (broadcasts, alerts, message pings are staff-written).
-- This does not weaken any SELECT/UPDATE/DELETE policy.
-- ============================================================
DROP POLICY IF EXISTS "Authenticated can insert notifications" ON public.notifications;
CREATE POLICY "Users self-insert; staff insert any"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR user_id = public.get_my_profile_id()
    OR public.get_my_user_type() IN ('teacher', 'admin')
  );


-- ============================================================
-- H-9: Mask games_pin for non-admins in admin_bank_list_students().
--
-- The PIN is the sole login credential for young students; returning it
-- in plaintext to every teacher is school-wide impersonation + FERPA PII.
-- Redefined so only admins receive the plaintext pin; teachers get NULL.
-- All other columns (incl. has_pin so the UI can still show "PIN set")
-- are unchanged, so the Bank Helper UI keeps working.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_bank_list_students()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_type TEXT;
  v_rows JSON;
BEGIN
  SELECT user_type INTO v_caller_type
  FROM public.user_profiles
  WHERE auth_user_id = auth.uid();

  IF v_caller_type NOT IN ('admin', 'teacher') THEN
    RETURN json_build_object('success', false, 'error', 'Admin or teacher access required');
  END IF;

  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.last_name, t.first_name), '[]'::json) INTO v_rows
  FROM (
    SELECT
      up.id,
      up.first_name,
      up.last_name,
      up.grade_level,
      COALESCE(up.student_status, 'active') AS student_status,
      COALESCE(up.rtc_balance, 0) AS wallet_balance,
      COALESCE(ba.balance, 0) AS bank_balance,
      (up.games_pin IS NOT NULL) AS has_pin,
      -- H-9: only admins may read the plaintext PIN. Teachers get NULL.
      CASE WHEN v_caller_type = 'admin' THEN up.games_pin ELSE NULL END AS pin
    FROM public.user_profiles up
    LEFT JOIN public.rtc_bank_accounts ba ON ba.user_id = up.id
    WHERE up.user_type = 'student'
  ) t;

  RETURN json_build_object('success', true, 'students', v_rows);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_bank_list_students() TO authenticated;


-- ============================================================
-- Repo-integrity: student_notes admin policy referenced a nonexistent
-- `profiles.role`. Production has aliases so it hasn't errored, but the
-- policy predicate never matches under the real user_profiles schema
-- (which uses user_type). Correct it to the canonical helper. Admin-only
-- scope is preserved — this does not weaken the policy.
-- ============================================================
DROP POLICY IF EXISTS "Admins can manage all notes" ON public.student_notes;
CREATE POLICY "Admins can manage all notes"
  ON public.student_notes FOR ALL
  TO authenticated
  USING (public.get_my_user_type() = 'admin')
  WITH CHECK (public.get_my_user_type() = 'admin');


-- ============================================================
-- Repo-integrity: re-ensure math_dojo_sessions.subject exists.
-- add_subject_to_dojo_sessions.sql sorts BEFORE its CREATE
-- (math_dojo_sessions.sql), so on a fresh deploy the column add is a
-- no-op there (guarded) and the table is created without the column.
-- This runs last (after the CREATE) and adds the column + index. On an
-- already-migrated DB it is a harmless no-op.
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'math_dojo_sessions'
  ) THEN
    ALTER TABLE public.math_dojo_sessions
      ADD COLUMN IF NOT EXISTS subject TEXT NOT NULL DEFAULT 'Math';
    CREATE INDEX IF NOT EXISTS idx_math_dojo_sessions_user_subject
      ON public.math_dojo_sessions(user_id, subject, created_at DESC);
  END IF;
END $$;

-- ============================================================
-- H-10: reactivate_student() must also clear the login gate.
--
-- The self-serve "Activate Account" flow and the admin "Reactivate" path
-- both call reactivate_student(p_student_id). The existing versions only
-- set student_status='active' (+ clear left_date/left_reason) but leave
-- account_status and can_login untouched — so the login gate
-- (can_login = true AND account_status <> 'inactive') still rejects the
-- student and they can never log in (the H-10 activation loop).
--
-- This redefinition ALSO sets account_status='active' and can_login=true.
-- It stays SECURITY DEFINER (owner, not the authenticated caller), so the
-- SECURITY INVOKER protect_user_profile_columns trigger takes its bypass
-- branch and the protected-column writes actually land — a direct
-- PostgREST UPDATE of those columns would be silently reverted, which is
-- exactly why this has to be an RPC.
--
-- Authorization: preserved as-is. No prior version restricted the caller
-- (any authenticated user could reactivate any student), so both the
-- self-serve claim path (student reactivating their OWN profile.id) and
-- the admin/teacher reactivation path continue to work unchanged. We do
-- NOT add a new role gate here — doing so would break the student
-- self-activation flow that H-10 depends on. The WHERE clause keeps the
-- action scoped to student rows only.
--
-- DROP first so the return type can be normalized to JSON regardless of
-- whichever prior signature (void vs JSON) is currently deployed; the
-- frontend only checks the error channel, so JSON is backward-compatible.
-- ============================================================
DROP FUNCTION IF EXISTS public.reactivate_student(UUID);

CREATE OR REPLACE FUNCTION public.reactivate_student(p_student_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.user_profiles
  SET student_status = 'active',
      left_date      = NULL,
      left_reason    = NULL,
      -- H-10: clear the login gate so an activated/reactivated student
      -- can actually sign in.
      account_status = 'active',
      can_login      = true
  WHERE id = p_student_id AND user_type = 'student';

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Student not found');
  END IF;

  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reactivate_student(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reactivate_student(UUID) TO service_role;


-- ============================================================
-- Done.
-- ============================================================
