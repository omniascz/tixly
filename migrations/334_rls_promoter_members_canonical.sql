-- RLS Fáze 2, Vlna C fix: platform.promoter_members na kanonický kontrakt.
-- Stará policy (z 285/303) = app_is_platform_admin() OR promoter_id=app_current_promoter_id()
-- → neměla app_is_service() ani user_id self-access. Login (getUserRoles ve service kontextu)
-- proto viděl 0 členství → promotér se nepřihlásil do /admin.
--
-- Kanonický model: admin || service || vlastní členství (user) || vlastní org (promotér).

DROP POLICY IF EXISTS p_promoter_members_tenant ON platform.promoter_members;
CREATE POLICY p_promoter_members_scope ON platform.promoter_members FOR ALL
  USING (
    app_is_platform_admin() OR app_is_service()
    OR user_id = app_current_user_id()
    OR promoter_id = app_current_promoter_id()
  );
