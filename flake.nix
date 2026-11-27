{
  description = "Chaikadi static PWA development and checks (no build step)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "aarch64-darwin" "x86_64-darwin" "aarch64-linux" "x86_64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      devShells = forAllSystems (system:
        let pkgs = import nixpkgs { inherit system; };
        in {
          default = pkgs.mkShell {
            packages = [ pkgs.nodejs_22 pkgs.python3 pkgs.curl pkgs.playwright-driver pkgs.treefmt pkgs.nixpkgs-fmt ]
              ++ nixpkgs.lib.optionals pkgs.stdenv.isLinux [
              pkgs.chromium
              pkgs.iw
              pkgs.iptables
              pkgs.linux-wifi-hotspot
              pkgs.qrencode
              (pkgs.writeShellScriptBin "stun-hotspot" ''exec bash ${./tools/stun-hotspot.sh} "$@"'')
            ];
            shellHook = ''
              export PLAYWRIGHT_MODULE=${pkgs.playwright-driver}/index.mjs
              ${nixpkgs.lib.optionalString pkgs.stdenv.isLinux "export CHROME=${pkgs.chromium}/bin/chromium"}
              echo "Chaikadi: npm test | npm run test:e2e | python3 tools/serve.py"
              echo "Phone NAT test: stun-hotspot start | stun-hotspot status | stun-hotspot stop"
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
