{
  description = "Development shell for obsidian-note-sync";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    devenv.url = "github:cachix/devenv";
  };

  outputs = { self, nixpkgs, flake-utils, devenv, ... }@inputs:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in {
        devShells.default = devenv.lib.mkShell {
          inherit inputs system;

          modules = [
            ({ pkgs, ... }: {
              packages = with pkgs; [
                git
                gh
                nodejs_20
              ];
            })
          ];
        };
      });
}
