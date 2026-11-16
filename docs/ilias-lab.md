# Local ILIAS 10.12 lab

A disposable local ILIAS used **only as structure evidence** for object types
and views that the student account cannot reach on ADAM (issues #127–#131,
staff views #128). adam-mcp never talks to it: the origin stays pinned to
`https://adam.unibas.ch`, and nothing from the lab is used at runtime.

ADAM reports `ILIAS 10.12` on PHP `8.2.35`; the lab matches both.

## Requirements

Docker Engine with Compose v2, for example inside WSL2 Ubuntu:

```bash
sudo apt-get install -y docker.io docker-compose-v2 && sudo usermod -aG docker $USER
```

## Start

```bash
git clone --depth 1 --branch v10.12 https://github.com/ILIAS-eLearning/ILIAS.git ~/ilias-lab/ILIAS
cd tools/ilias-lab
ILIAS_SRC=$HOME/ilias-lab/ILIAS docker compose up --build -d
```

The first start runs `npm clean-install`, `composer install` and
`php cli/setup.php install` (several minutes). Then open
`http://localhost:8080/login.php`. Use the host name `localhost`: ILIAS only
accepts its configured host, and `127.0.0.1` is rejected as a disallowed host.

If Docker Desktop's credential helper was configured earlier
(`"credsStore": "desktop.exe"` in `~/.docker/config.json`), image pulls fail
inside WSL. Point `DOCKER_CONFIG` at an empty config for the lab instead of
editing your own.

## Notes

- The database runs as `utf8` / `utf8_general_ci` with InnoDB strict mode off,
  as ILIAS's install guide does. `utf8mb4` makes the base dump fail with error
  1118 (row size too large).
- The web port is bound to `127.0.0.1:8080` only.
- All passwords in `docker-compose.yml` and `config/ilias.json` are lab-only
  values for a throwaway local instance. Never reuse them, and never put a real
  SWITCH credential anywhere in the lab.
- Reset everything with `docker compose down -v`, then remove `ilias.ini.php`
  and `public/data/lab` from the ILIAS checkout (they belong to the container's
  web user, so remove them from a container, e.g.
  `docker run --rm -v $ILIAS_SRC:/src alpine rm -rf /src/ilias.ini.php /src/public/data/lab`).

## Capturing structure

Captures from the lab use the same structure-only approach as ADAM evidence:
tags, classes and route shapes, with text masked. They are labelled
**lab-verified, ADAM-unverified** until the same view is seen on ADAM.
