-- =============================================================================
-- SOLUSSIMO — Migration 011 : lecture des fiches collaborateurs (INSERT … RETURNING)
--
-- Constaté sur Supabase dev : la création d'une fiche via l'API (INSERT … RETURNING)
-- était refusée, car la politique de lecture recherchait la fiche par son id alors
-- que la nouvelle ligne n'est pas encore visible dans l'instantané de la requête.
-- La politique évalue désormais d'abord les colonnes de la ligne elle-même
-- (entreprise, compte lié, établissement principal), sans élargir les droits.
-- =============================================================================

drop policy staff_members_select on public.staff_members;
create policy staff_members_select on public.staff_members
  for select to authenticated
  using (
    private.is_company_admin(company_id)
    or user_id = (select auth.uid())
    or private.is_assigned_to_establishment(establishment_id)
    or private.can_see_staff(id)
  );
