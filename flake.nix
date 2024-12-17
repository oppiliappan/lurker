{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
  };

  outputs = {
    self,
    nixpkgs,
  }: let
    supportedSystems = ["x86_64-linux" "aarch64-linux" "aarch64-darwin"];
    forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
    nixpkgsFor = forAllSystems (system:
      import nixpkgs {
        inherit system;
        overlays = [
          self.overlays.default
        ];
      });
  in {
    overlays.default = final: prev: let
      pname = "lurker";
      version = "0.1.0";
    in {
      node_modules = with final;
        stdenv.mkDerivation {
          pname = "lurker-node-modules";
          version = "0.0.1";
          impureEnvVars =
            lib.fetchers.proxyImpureEnvVars
            ++ ["GIT_PROXY_COMMAND" "SOCKS_SERVER"];
          src = ./.;
          nativeBuildInputs = [bun];
          buildInputs = [nodejs-slim_latest];
          dontConfigure = true;
          dontFixup = true;
          buildPhase = ''
            bun install --no-progress --frozen-lockfile
          '';
          installPhase = ''
            mkdir -p $out/node_modules
            cp -R ./node_modules/* $out/node_modules
            ls -la $out/node_modules
          '';
          outputHash = "sha256-kjj/UmY2rGIpi+NuMttdzzNPm0XD1dwhTKgLbkflUAI=";
          outputHashAlgo = "sha256";
          outputHashMode = "recursive";
        };
      lurker = with final;
        stdenv.mkDerivation {
          inherit pname version;
          src = ./.;
          nativeBuildInputs = [makeBinaryWrapper];
          buildInputs = [bun];

          buildPhase = ''
            runHook preBuild
            runHook postBuild
          '';

          dontFixup = true;

          installPhase = ''
            runHook preInstall

            mkdir -p $out/bin

            ln -s ${node_modules}/node_modules $out
            cp -R ./* $out

            makeBinaryWrapper ${bun}/bin/bun $out/bin/$pname \
            --prefix PATH : ${lib.makeBinPath [bun]} \
            --add-flags "run --prefer-offline --no-install $out/src/index.js"

          '';
        };
      dockerImage = with final;
        final.dockerTools.buildImage {
          name = pname;
          tag = "latest";

          copyToRoot = final.buildEnv {
            name = "image-root";
            paths = [final.lurker];
            pathsToLink = ["/bin"];
          };

          runAsRoot = ''
            mkdir -p /data
          '';

          config = {
            Cmd = ["/bin/${pname}"];
            WorkingDir = "/data";
            Volumes = {"/data" = {};};
          };
        };
    };

    devShell = forAllSystems (system: let
      pkgs = nixpkgsFor."${system}";
    in
      pkgs.mkShell {
        nativeBuildInputs = [
          pkgs.bun
          pkgs.biome
          pkgs.typescript-language-server
        ];
      });

    packages = forAllSystems (system: {
      inherit (nixpkgsFor."${system}") lurker node_modules dockerImage;
    });

    defaultPackage = forAllSystems (system: nixpkgsFor."${system}".lurker);

    apps = forAllSystems (system: let
      pkgs = nixpkgsFor.${system};
    in {
      default = {
        type = "app";
        program = "${pkgs.lurker}/bin/lurker";
      };
    });

    formatter = forAllSystems (system: nixpkgsFor."${system}".alejandra);

    nixosModules.default = {
      config,
      pkgs,
      lib,
      ...
    }:
      with lib; {
        options = {
          services.lurker = {
            enable = mkOption {
              type = types.bool;
              default = false;
              description = "Enable lurker";
            };
            port = mkOption {
              type = types.int;
              default = 3000;
              description = "Port to run lurker on";
            };
          };
        };

        config = mkIf config.services.lurker.enable {
          nixpkgs.overlays = [self.overlays.default];
          systemd.services.lurker = {
            description = "lurker service";
            wantedBy = ["multi-user.target"];

            serviceConfig = {
              ListenStream = "0.0.0.0:${toString config.services.lurker.port}";
              ExecStart = "${pkgs.lurker}/bin/lurker";
              Restart = "always";
            };

            # If the binary needs specific environment variables, set them here
            environment = {
              LURKER_PORT = "${toString config.services.lurker.port}";
            };
          };
        };
      };
  };
}
