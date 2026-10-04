{ pkgs ? import <nixpkgs> {} }:
let
  package = pkgs.stdenv.mkDerivation (final: {
    pname = "agents";
    version = "dev";
    src = ./.;
    nativeBuildInputs = [ pkgs.makeWrapper ];
    installPhase = ''
      mkdir -p $out/share/agents/
      cp -rv ./*/ $out/share/agents/
      cp -v run.sh $out/share/agents/
      mkdir -p $out/bin/
      makeWrapper $out/share/agents/run.sh $out/bin/agent-run \
        --set "AGENTS_DIR" "$out/share/agents" \
        --prefix "PATH" ":" "${pkgs.lib.makeBinPath [ pkgs.jq ]}"
    '';
  });
in
  package
