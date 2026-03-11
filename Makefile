.DEFAULT_GOAL := build

NODE_MODULES_STAMP := node_modules/.npm-install.stamp

.PHONY: build dev lint clean

$(NODE_MODULES_STAMP): package-lock.json
	npm install
	touch $(NODE_MODULES_STAMP)

build: $(NODE_MODULES_STAMP)
	npm run build

dev: $(NODE_MODULES_STAMP)
	npm run dev

lint: $(NODE_MODULES_STAMP)
	npm run lint

clean:
	rm -f $(NODE_MODULES_STAMP)
	rm -rf node_modules
