{
  description = "Chaikadi static PWA development and checks (no build step)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "aarch64-darwin" "x86_64-darwin" "aarch64-linux" "x86_64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in {
      devShells = forAllSystems (system:
        let pkgs = import nixpkgs { inherit system; };
        in {
          default = pkgs.mkShell {
            packages = [ pkgs.nodejs_22 pkgs.python3 pkgs.curl ];
            shellHook = ''
              echo "Chaikadi: npm test | python3 tools/serve.py"
              echo "No npm install or build needed. Phones require HTTPS."
            '';
          };
        });
      checks = forAllSystems (system:
        let pkgs = import nixpkgs { inherit system; };
        in {
          tests = pkgs.runCommand "chaikadi-tests" { nativeBuildInputs = [ pkgs.nodejs_22 ]; } ''
            cp -R ${self} source
            chmod -R u+w source
            cd source
            node --test tests/*.test.js
            touch $out
          '';
        });
    };
}
