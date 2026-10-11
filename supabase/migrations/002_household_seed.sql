-- The one household and the two people allowed to sign up to it.
with h as (
  insert into household.households (name) values ('הבית שלנו') returning id
)
insert into household.invites (email, household_id, display_name)
select e, h.id, n from h, (values ('yardenkal207@gmail.com', 'ירדן'), ('roniesh1245@gmail.com', 'רוני')) v(e, n);
