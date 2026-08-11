let
  pkgs = import <nixpkgs> { };
in
  pkgs.mkShell {
    name = "env";
    packages = with pkgs; [
      llvmPackages.clang-unwrapped
      llvmPackages.libllvm
      pkg-config
      bpftrace
      bpftools
      libbpf
      nodejs
      go
    ];
    shellHook = ''
      export LIBCLANG_PATH=${pkgs.llvmPackages.libclang}/lib
      export C_INCLUDE_PATH=${pkgs.libbpf}/include:$C_INCLUDE_PATH
    '';
    hardeningDisable = [
      "zerocallusedregs"
    ];
    env.NIX_CC_WRAPPER_SUPPRESS_TARGET_WARNING = "1";
  }
