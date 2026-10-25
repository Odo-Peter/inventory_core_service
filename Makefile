# Makefile for inventory-core (NestJS)

.PHONY: help install build start dev debug prod \
        lint format test test-watch test-cov test-e2e test-debug \
        deploy clean \
        up down logs ps db-shell restart \
        db-generate db-migrate-dev db-migrate-deploy db-migrate-status db-migrate

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
	@echo "  make test-e2e      Run end-to-end tests"
	@echo "  make test-debug    Run tests in debug mode"
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
	@echo ""
	@echo "Other"
	@echo "  make deploy        Deploy the application"
	@echo "  make clean         Remove build artifacts"

# ======================
# Dependencies
# ======================
install:
	npm install

# ======================
# Build & Run
# ======================
build:
	npm run build

start:
	npm run start

dev:
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

test-e2e:
	npm run test:e2e

test-debug:
	npm run test:debug

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

# ======================
# Deploy & Cleanup
# ======================
deploy:
	npm run deploy

clean:
	rm -rf dist coverage