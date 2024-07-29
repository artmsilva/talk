check_running:
	# Is the docker daemon running?
	@if ! docker info >/dev/null 2>&1; then \
		echo "Docker is not running. Please start Docker."; \
		exit 1; \
	fi
	@if ! docker ps -q -f name=mongo >/dev/null; then \
		docker run -d -p 27017:27017 --restart always --name mongo mongo:4.2; \
	fi
	@if ! docker ps -q -f name=redis >/dev/null; then \
		docker run -d -p 6379:6379 --restart always --name redis redis:3.2; \
	fi

setup:
	sh scripts/pnpm-i.sh
	make check_running
	sh initialize.sh

	