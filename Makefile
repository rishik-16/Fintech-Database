.PHONY: up down seed test demo migrate clean clean-volumes reset logs db-shell

up:
	docker compose up --build -d

down:
	docker compose down

seed: migrate
	docker compose exec api python -m scripts.seed

migrate:
	docker compose exec api python -m scripts.migrate

test:
	docker compose exec api python -m pytest tests/ -v --tb=short

demo:
	docker compose exec api python -m scripts.concurrency_demo

clean:
	docker compose down

clean-volumes:
	docker compose down -v

reset:
	docker compose down -v
	docker compose up --build -d

logs:
	docker compose logs -f

db-shell:
	docker compose exec db psql -U payledger_admin -d payledger
