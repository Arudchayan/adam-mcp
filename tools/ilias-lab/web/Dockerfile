# ADAM runs ILIAS 10.12 on PHP 8.2 ("10.12 - 8.2.35" in its footer).
FROM php:8.2-apache
RUN apt-get update && apt-get install -y --no-install-recommends \
      git unzip libpng-dev libjpeg-dev libfreetype6-dev libxslt1-dev libzip-dev libicu-dev \
      libmagickwand-dev libxml2-dev imagemagick ghostscript nodejs npm mariadb-client \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j"$(nproc)" gd xsl zip pdo_mysql mysqli intl opcache soap \
    && pecl install imagick && docker-php-ext-enable imagick \
    && rm -rf /var/lib/apt/lists/*
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
RUN a2enmod rewrite headers \
    && sed -ri 's#DocumentRoot /var/www/html#DocumentRoot /var/www/ilias/public#' /etc/apache2/sites-available/000-default.conf \
    # ILIAS SOAP loads its own WSDL from the request's host (localhost:8080), so the
    # container must also answer on 8080, not only on the mapped port 80.
    && echo 'Listen 8080' >> /etc/apache2/ports.conf \
    && sed -ri 's#<VirtualHost \*:80>#<VirtualHost *:80 *:8080>#' /etc/apache2/sites-available/000-default.conf \
    && printf '<Directory /var/www/ilias/public>\n  AllowOverride All\n  Require all granted\n</Directory>\n' > /etc/apache2/conf-enabled/ilias.conf \
    && printf 'memory_limit=512M\nmax_execution_time=600\nupload_max_filesize=64M\npost_max_size=64M\n' > /usr/local/etc/php/conf.d/ilias.ini \
    && mkdir -p /var/www/files /var/www/logs /var/www/.npm /var/www/.composer && chown -R www-data:www-data /var/www
COPY entrypoint.sh /usr/local/bin/ilias-lab-entrypoint
RUN chmod +x /usr/local/bin/ilias-lab-entrypoint
ENTRYPOINT ["ilias-lab-entrypoint"]
CMD ["apache2-foreground"]
