UUID := spotify-autoeq-status@hllerden.github.io
FILES := metadata.json extension.js logic.js stylesheet.css icons LICENSE
INSTALL_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: test pack install uninstall clean

test:
	gjs tests/run.js

pack: test
	mkdir -p dist
	rm -f dist/$(UUID).zip
	zip -qr dist/$(UUID).zip $(FILES)
	@echo "built dist/$(UUID).zip"

# Copies the extension for the current user; enable it afterwards with
#   gnome-extensions enable $(UUID)
install:
	mkdir -p $(INSTALL_DIR)
	cp -r $(FILES) $(INSTALL_DIR)/
	@echo "installed to $(INSTALL_DIR)"

uninstall:
	-gnome-extensions disable $(UUID)
	rm -rf $(INSTALL_DIR)

clean:
	rm -rf dist
