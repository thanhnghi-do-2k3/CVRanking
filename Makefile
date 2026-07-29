.PHONY: bootstrap up down logs test test-go test-ai test-web lint compose-config migrate-down ranking-fixtures ranking-demo-seed ranking-load-seed ranking-smoke

bootstrap:
	cp -n .env.example .env || true
	cd frontend && npm install
	cd ai-service && python3 -m pip install -r requirements-dev.txt
	cd backend && go mod download

up:
	docker compose up --build

down:
	docker compose down

logs:
	docker compose logs -f api worker ai-service frontend

test: test-go test-ai test-web

test-go:
	cd backend && go test ./...

test-ai:
	cd ai-service && python3 -m pytest

test-web:
	cd frontend && npm run typecheck && npm run lint && npm run test

lint:
	cd backend && gofmt -w $$(find . -name '*.go' -not -path './vendor/*')
	cd ai-service && python3 -m ruff check .
	cd frontend && npm run lint

compose-config:
	docker compose config --quiet

migrate-down:
	docker compose run --rm -e MIGRATION_COMMAND=down migrate

ranking-fixtures:
	python3 scripts/generate-ranking-fixtures.py

ranking-demo-seed:
	node scripts/seed-ranking-demo.mjs

ranking-load-seed:
	node scripts/seed-ranking-loadtest.mjs

ranking-smoke:
	bash scripts/ranking-smoke.sh
