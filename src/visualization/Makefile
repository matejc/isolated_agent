.PHONY: all
all: check-tools build

check-tools:
	@command -v node >/dev/null || { echo "node is required" >&2; exit 1; }
	@command -v npm >/dev/null || { echo "npm is required" >&2; exit 1; }

build: check-tools
	npm install

clean:
	rm -rf node_modules
