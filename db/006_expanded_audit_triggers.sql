-- ============================================================
-- Create audit_log_trigger function + attach to all key tables
-- ============================================================

CREATE OR REPLACE FUNCTION audit_log_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_company_id  UUID;
  v_actor_id    UUID;
  v_actor_role  TEXT;
  v_action      TEXT;
  v_old         JSONB;
  v_new         JSONB;
  v_changed     TEXT[];
  v_record_id   UUID;
BEGIN
  -- Determine action
  IF    TG_OP = 'INSERT' THEN v_action := 'INSERT';
  ELSIF TG_OP = 'UPDATE' THEN v_action := 'UPDATE';
  ELSIF TG_OP = 'DELETE' THEN v_action := 'DELETE';
  END IF;

  -- Resolve record + company
  IF TG_OP = 'DELETE' THEN
    v_record_id  := OLD.id;
    v_company_id := CASE WHEN TG_TABLE_NAME = 'companies' THEN OLD.id ELSE OLD.company_id END;
    v_old        := to_jsonb(OLD);
    v_new        := NULL;
  ELSE
    v_record_id  := NEW.id;
    v_company_id := CASE WHEN TG_TABLE_NAME = 'companies' THEN NEW.id ELSE NEW.company_id END;
    v_new        := to_jsonb(NEW);
    IF TG_OP = 'UPDATE' THEN
      v_old := to_jsonb(OLD);
      -- Compute changed fields
      SELECT array_agg(key) INTO v_changed
      FROM jsonb_each(v_new) n
      JOIN jsonb_each(v_old) o USING (key)
      WHERE n.value IS DISTINCT FROM o.value;
    END IF;
  END IF;

  -- Get actor from session variables (set by withRLS in the app)
  BEGIN
    v_actor_id   := current_setting('app.user_id',  TRUE)::UUID;
    v_actor_role := current_setting('app.user_role', TRUE);
  EXCEPTION WHEN OTHERS THEN
    v_actor_id   := NULL;
    v_actor_role := NULL;
  END;

  -- Skip if no company (e.g. super_admin rows with null company_id)
  IF v_company_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Remove sensitive fields from logged values
  IF v_new IS NOT NULL THEN
    v_new := v_new - 'password_hash' - 'password' - 'secret';
  END IF;
  IF v_old IS NOT NULL THEN
    v_old := v_old - 'password_hash' - 'password' - 'secret';
  END IF;

  INSERT INTO audit_logs (
    company_id, table_name, record_id, action,
    actor_id, actor_role,
    old_values, new_values, changed_fields,
    created_at
  ) VALUES (
    v_company_id, TG_TABLE_NAME, v_record_id, v_action,
    v_actor_id, v_actor_role,
    v_old, v_new, v_changed,
    NOW()
  );

  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  -- Never let audit failures break the main operation
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ── Attach triggers ───────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_audit_properties ON properties;
CREATE TRIGGER trg_audit_properties
  AFTER INSERT OR UPDATE OR DELETE ON properties
  FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();

DROP TRIGGER IF EXISTS trg_audit_units ON units;
CREATE TRIGGER trg_audit_units
  AFTER INSERT OR UPDATE OR DELETE ON units
  FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();

DROP TRIGGER IF EXISTS trg_audit_users ON users;
CREATE TRIGGER trg_audit_users
  AFTER INSERT OR UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();

DROP TRIGGER IF EXISTS trg_audit_maintenance ON maintenance_requests;
CREATE TRIGGER trg_audit_maintenance
  AFTER INSERT OR UPDATE ON maintenance_requests
  FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();

DROP TRIGGER IF EXISTS trg_audit_companies ON companies;
CREATE TRIGGER trg_audit_companies
  AFTER UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();

DROP TRIGGER IF EXISTS trg_audit_caretaker_perms ON caretaker_permissions;
CREATE TRIGGER trg_audit_caretaker_perms
  AFTER INSERT OR UPDATE ON caretaker_permissions
  FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();

DROP TRIGGER IF EXISTS trg_audit_manager_assignments ON manager_property_assignments;
CREATE TRIGGER trg_audit_manager_assignments
  AFTER INSERT OR UPDATE ON manager_property_assignments
  FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();

DROP TRIGGER IF EXISTS trg_audit_notifications ON notifications;
CREATE TRIGGER trg_audit_notifications
  AFTER INSERT ON notifications
  FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();