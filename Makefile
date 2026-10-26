# Makefile for inventory-core (NestJS)

.PHONY: help install build start dev debug prod \
        lint format test test-watch test-cov test-e2e test-debug \
        test-db-up test-db-create test-db-reset test-db-drop test-env-check \
        deploy clean \
        up down logs ps db-shell restart db-ensure \
        db-generate db-migrate-dev db-migrate-deploy db-migrate-status db-migrate db-seed

TEST_DB := pos_test

# Refuse to run at all if TEST_DB is not a *_test name (the drop below is destructive).
ifneq ($(filter %_test,$(TEST_DB)),$(TEST_DB))
$(error TEST_DB must end with _test, got "$(TEST_DB)")
endif

# Default target
help:
	@echo "Available commands:"
	@echo ""
	@echo "Application"
	@echo "  make install       Install dependencies"
	@echo "  make build         Build the application"
	@echo "  make start         Start the application (once)"
	@echo "  make dev           Start in development mode (watch)"
	@echo "  make debug         Start in debug + watch mode"
	@echo "  make prod          Start production build"
	@echo ""
	@echo "Code Quality"
	@echo "  make lint          Run linter (oxlint)"
	@echo "  make format        Format code with Prettier"
	@echo ""
	@echo "Testing"
	@echo "  make test          Run unit tests"
	@echo "  make test-watch    Run unit tests in watch mode"
	@echo "  make test-cov      Run unit tests with coverage"
	@echo "  make test-e2e      E2E in one go: start DB, create+reset test DB, run, drop on success"
	@echo "                     (KEEP_DB=1 keeps the test DB after a passing run)"
	@echo "  make test-db-create / test-db-reset / test-db-drop   Manage the test DB individually"
	@echo ""
	@echo "Docker / Database"
	@echo "  make up            Start infrastructure (Postgres)"
	@echo "  make down          Stop infrastructure"
	@echo "  make restart       Restart infrastructure"
	@echo "  make logs          Follow infrastructure logs"
	@echo "  make ps            Show running containers"
	@echo "  make db-shell      Open psql shell in the database"
	@echo ""
	@echo "Prisma / Migrations"
	@echo "  make db-generate              Generate Prisma Client"
	@echo "  make db-migrate-dev           Run migrate dev (interactive)"
	@echo "  make db-migrate name=foo      Create a named migration (migrate dev --name)"
	@echo "  make db-migrate-deploy        Apply migrations (production)"
	@echo "  make db-migrate-status        Show migration status"
	@echo "  make db-seed              Seed admin details from .env"
	@echo "  make db-reset             Interactive Reset - NOTE: All data in the database will be erased."
	@echo ""
	@echo "Other"
	@echo "  make deploy        Deploy the application"
	@echo "  make clean         Remove build artifacts"

# ======================
# Dependencies
# ======================
install:
	npm install

# Start Postgres only if it isn't already running, and wait until it is healthy.
db-ensure:
	@if docker compose ps --status running --services | grep -qx db; then \
		echo "Database already running"; \
	else \
		echo "Database not running, starting it..."; \
	fi
	@docker compose up -d --wait db

# ======================
# Build & Run
# ======================
build:
	npm run build

start:
	npm run start

dev: db-ensure
	npm run start:dev

debug:
	npm run start:debug

prod:
	npm run start:prod

# ======================
# Code Quality
# ======================
lint:
	npm run lint

format:
	npm run format

# ======================
# Testing
# ======================
test:
	npm run test

test-watch:
	npm run test:watch

test-cov:
	npm run test:cov

test-debug:
	npm run test:debug

# One command: start DB -> create test DB -> reset + migrate -> run e2e -> drop test DB (only on success).
# Keep the DB after a passing run:  make test-e2e KEEP_DB=1
test-e2e:
	@$(MAKE) --no-print-directory test-env-check
	@$(MAKE) --no-print-directory test-db-up
	@$(MAKE) --no-print-directory test-db-create
	@$(MAKE) --no-print-directory test-db-reset
	npm run test:e2e
	@if [ -z "$(KEEP_DB)" ]; then \
		$(MAKE) --no-print-directory test-db-drop; \
	else \
		echo "KEEP_DB set: leaving $(TEST_DB) in place"; \
	fi

# .env.test must point at exactly this test database.
test-env-check:
	@grep -Eq '^DATABASE_URL=.*/$(TEST_DB)(\?.*)?$$' .env.test || \
		(echo "DATABASE_URL in .env.test must end with /$(TEST_DB)"; exit 1)

# Start Postgres and wait until its healthcheck passes.
test-db-up:
	docker compose up -d --wait db

# Create the test database if it does not exist (silent when it already does).
test-db-create:
	@printf '%s\n' "SELECT 'CREATE DATABASE $(TEST_DB)' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$(TEST_DB)')\gexec" \
		| docker compose exec -T db sh -c 'psql -U "$$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1'

# Drop everything in the test DB, re-apply all migrations, regenerate the client.
test-db-reset: test-env-check
	set -a && . ./.env.test && set +a && npx prisma migrate reset --force && npx prisma generate

# Remove the test database entirely (never touches the dev database).
test-db-drop: test-env-check
	docker compose exec -T db sh -c 'psql -U "$$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $(TEST_DB) WITH (FORCE)"'


# ======================
# Docker Compose (Postgres)
# ======================
up:
	docker compose up -d

down:
	docker compose down

restart:
	docker compose down
	docker compose up -d

logs:
	docker compose logs -f

ps:
	docker compose ps

db-shell:
	docker compose exec db sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

# ======================
# Prisma / Migrations
# ======================
db-generate:
	npm run db:generate

# Interactive / default migrate dev (Prisma will prompt for a name if needed)
db-migrate-dev:
	npm run db:migrate:dev

# Create a named migration locally
# Usage: make db-migrate name=add_inventory_location
db-migrate:
	@if [ -z "$(name)" ]; then \
		echo "Error: migration name is required. Usage: make db-migrate name=add_inventory_location"; \
		exit 1; \
	fi
	npx prisma migrate dev --name $(name)

db-migrate-deploy:
	npm run db:migrate:deploy

db-migrate-status:
	npm run db:migrate:status

db-seed:
	npm run db:seed

db-reset:
	npx prisma migrate reset

# ======================
# Deploy & Cleanup
# ======================
deploy:
	npm run deploy

clean:
	rm -rf dist coverage