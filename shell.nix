let
  pkgs = import <nixpkgs> { };
in
  pkgs.mkShell {
    name = "env";
    packages = with pkgs; [
      llvmPackages.clang-unwrapped
      pkg-config
      bpftrace
      bpftools
      libbpf
    ];
    shellHook = ''
      export LIBCLANG_PATH="${pkgs.llvmPackages.libclang}/lib";
    '';
    hardeningDisable = [
      "zerocallusedregs"
    ];
    env.NIX_CC_WRAPPER_SUPPRESS_TARGET_WARNING = "1";
  }
