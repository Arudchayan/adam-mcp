#!/bin/sh
# Lab-only database tweaks the ILIAS UI would otherwise need clicking for.
#   prepare : enable SOAP, skip forced password changes for the lab accounts
#             (run again after seed.mjs has imported the lab users)
#   online  : switch every "Lab …" seed object online (ILIAS creates them offline)
# Run from tools/ilias-lab with ILIAS_SRC set (see docs/ilias-lab.md).
set -e
sql() { docker compose exec -T db mariadb -uilias -plab-only-db-password ilias -e "$1"; }
case "$1" in
  prepare)
    sql "update settings set value='1' where keyword='soap_user_administration';
         update settings set value='0' where keyword='ps_password_change_on_first_login_enabled';
         update usr_data set last_password_change=unix_timestamp(), passwd_policy_reset=0 where login='root' or login like 'lab.%';" ;;
  online)
    sql "update object_data set offline=0 where title like 'Lab %';
         select count(*) as lab_objects_online from object_data where title like 'Lab %' and offline=0;" ;;
  *) echo "usage: $0 prepare|online" >&2; exit 2 ;;
esac
