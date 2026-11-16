#!/bin/sh
# First start: install dependencies and run the ILIAS CLI setup once.
set -e
cd /var/www/ilias
if [ ! -f /var/www/files/.lab-installed ]; then
  chown -R www-data:www-data /var/www/ilias /var/www/files /var/www/logs
  su -s /bin/sh www-data -c "HOME=/var/www npm clean-install --omit=dev --ignore-scripts"
  su -s /bin/sh www-data -c "HOME=/var/www composer install --no-dev --no-interaction"
  su -s /bin/sh www-data -c "php cli/setup.php install --yes /var/www/config/ilias.json"
  touch /var/www/files/.lab-installed
fi
exec "$@"
