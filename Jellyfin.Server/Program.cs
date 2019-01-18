using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Security;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using Emby.Drawing;
using Emby.Drawing.Skia;
using Emby.Server.Implementations;
using Emby.Server.Implementations.EnvironmentInfo;
using Emby.Server.Implementations.IO;
using Emby.Server.Implementations.Networking;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Net;
using MediaBrowser.Controller.Drawing;
using MediaBrowser.Model.IO;
using MediaBrowser.Model.Globalization;
using MediaBrowser.Model.System;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Serilog;
using Serilog.AspNetCore;
using ILogger = Microsoft.Extensions.Logging.ILogger;

namespace Jellyfin.Server
{
    public static class Program
    {
        private static readonly CancellationTokenSource _tokenSource = new CancellationTokenSource();
        private static readonly ILoggerFactory _loggerFactory = new SerilogLoggerFactory();
        private static ILogger _logger;
        private static bool _restartOnShutdown;

        public static async Task Main(string[] args)
        {
            StartupOptions options = new StartupOptions(args);
            Version version = Assembly.GetEntryAssembly().GetName().Version;

            if (options.ContainsOption("-h") || options.ContainsOption("--help") || options.ContainsOption("/?"))
            {
                Console.WriteLine(
@"Jellyfin - The Free Software Media System

Usage: jellyfin [options]

Options:
  -h|--help|/?         Show command line help.
  -v|--version         Display Jellyfin version number.

Pathing Options:
  -programdata <path>  Path to use for program data (databases files etc.).
  -configdir <path>    Path to use for config data (user policies and puctures).
  -logdir <path>       Path to use for writing log files.

External FFmpeg:
 -ffmpeg <path>        Path to external FFmpeg exe to use in place of built-in.
 -ffprobe <path>       ffmpeg and ffprobe switches must be supplied together.

Restart:
  -restartpath         Path to reset script.
  -restartargs         Arguments for restart script.

Other:
  -service             Run as headless service.
  -noautorunwebapp     Run headless if startup wizard is complete.
  -package <name>      Used when packaging Jellyfin (example, synology).


Examples:
  jellyfin -configdir /user/home/config -logdir /tmp/logs
  jellyfin -ffmpeg C:\downloads\ffmpeg.exe -ffprobe C:\downloads\ffprobe.exe");
            }
            else if (options.ContainsOption("-v") || options.ContainsOption("--version"))
            {
                Console.WriteLine(Assembly.GetEntryAssembly().GetName().Version.ToString());
            }

            // Sanity check that both ffmpeg and ffprobe have been supplied
            else if (options.ContainsOption("-ffmpeg") && !options.ContainsOption("-ffprobe"))
            {
                Console.WriteLine("Must also supply -ffprobe <path> when using -ffmpeg");
            }
            else if (!options.ContainsOption("-ffmpeg") && options.ContainsOption("-ffprobe"))
            {
                Console.WriteLine("Must also supply -ffmpeg <path> when using -ffprobe");
            }

            // Start the main application and suspend
            else
            {
                await StartAppAsync(options).ConfigureAwait(false);
            }
        }

        private static async Task StartAppAsync(StartupOptions options)
        {
            ServerApplicationPaths appPaths = createApplicationPaths(options);
            // $JELLYFIN_LOG_DIR needs to be set for the logger configuration manager
            Environment.SetEnvironmentVariable("JELLYFIN_LOG_DIR", appPaths.LogDirectoryPath);
            await createLogger(appPaths);
            _logger = _loggerFactory.CreateLogger("Main");

            AppDomain.CurrentDomain.UnhandledException += (sender, e)
                => _logger.LogCritical((Exception)e.ExceptionObject, "Unhandled Exception");

            // Intercept Ctrl+C and Ctrl+Break
            Console.CancelKeyPress += (sender, e) =>
            {
                if (_tokenSource.IsCancellationRequested)
                {
                    return; // Already shutting down
                }
                e.Cancel = true;
                _logger.LogInformation("Ctrl+C, shutting down");
                Environment.ExitCode = 128 + 2;
                Shutdown();
            };

            // Register a SIGTERM handler
            AppDomain.CurrentDomain.ProcessExit += (sender, e) =>
            {
                if (_tokenSource.IsCancellationRequested)
                {
                    return; // Already shutting down
                }
                _logger.LogInformation("Received a SIGTERM signal, shutting down");
                Environment.ExitCode = 128 + 15;
                Shutdown();
            };

            _logger.LogInformation("Jellyfin version: {Version}", version);

            EnvironmentInfo environmentInfo = new EnvironmentInfo(getOperatingSystem());
            ApplicationHost.LogEnvironmentInfo(_logger, appPaths, environmentInfo);

            SQLitePCL.Batteries_V2.Init();

            // Allow all https requests
            ServicePointManager.ServerCertificateValidationCallback = new RemoteCertificateValidationCallback(delegate { return true; });

            var fileSystem = new ManagedFileSystem(_loggerFactory.CreateLogger("FileSystem"), environmentInfo, null, appPaths.TempDirectory, true);

            using (var appHost = new CoreAppHost(
                appPaths,
                _loggerFactory,
                options,
                fileSystem,
                environmentInfo,
                new NullImageEncoder(),
                new SystemEvents(_loggerFactory.CreateLogger("SystemEvents")),
                new NetworkManager(_loggerFactory.CreateLogger("NetworkManager"), environmentInfo)))
            {
                appHost.Init();

                appHost.ImageProcessor.ImageEncoder = getImageEncoder(_logger, fileSystem, options, () => appHost.HttpClient, appPaths, environmentInfo, appHost.LocalizationManager);

                _logger.LogInformation("Running startup tasks");

                await appHost.RunStartupTasks();

                // TODO: read input for a stop command

                try
                {
                    // Block main thread until shutdown
                    await Task.Delay(-1, _tokenSource.Token);
                }
                catch (TaskCanceledException)
                {
                    // Don't throw on cancellation
                }

                _logger.LogInformation("Disposing app host");
            }

            if (_restartOnShutdown)
            {
                StartNewInstance(options);
            }
        }

        private static ServerApplicationPaths createApplicationPaths(StartupOptions options)
        {
            string programDataPath = Environment.GetEnvironmentVariable("JELLYFIN_DATA_PATH");
            if (string.IsNullOrEmpty(programDataPath))
            {
                if (options.ContainsOption("-programdata"))
                {
                    programDataPath = options.GetOption("-programdata");
                }
                else
                {
                    if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
                    {
                        programDataPath = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
                    }
                    else
                    {
                        // $XDG_DATA_HOME defines the base directory relative to which user specific data files should be stored.
                        programDataPath = Environment.GetEnvironmentVariable("XDG_DATA_HOME");
                        // If $XDG_DATA_HOME is either not set or empty, $HOME/.local/share should be used.
                        if (string.IsNullOrEmpty(programDataPath))
                        {
                            programDataPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local", "share");
                        }
                    }
                    programDataPath = Path.Combine(programDataPath, "jellyfin");
                    // Ensure the dir exists
                    Directory.CreateDirectory(programDataPath);
                }
            }

            string configDir = Environment.GetEnvironmentVariable("JELLYFIN_CONFIG_DIR");
            if (string.IsNullOrEmpty(configDir))
            {
                if (options.ContainsOption("-configdir"))
                {
                    configDir = options.GetOption("-configdir");
                }
                else
                {
                    // Let BaseApplicationPaths set up the default value
                    configDir = null;
                }
            }

            string logDir = Environment.GetEnvironmentVariable("JELLYFIN_LOG_DIR");
            if (string.IsNullOrEmpty(logDir))
            {
                if (options.ContainsOption("-logdir"))
                {
                    logDir = options.GetOption("-logdir");
                }
                else
                {
                    // Let BaseApplicationPaths set up the default value
                    logDir = null;
                }
            }

            string appPath = AppContext.BaseDirectory;

            return new ServerApplicationPaths(programDataPath, appPath, appPath, logDir, configDir);
        }

        private static async Task createLogger(IApplicationPaths appPaths)
        {
            try
            {
                string configPath = Path.Combine(appPaths.ConfigurationDirectoryPath, "logging.json");

                if (!File.Exists(configPath))
                {
                    // For some reason the csproj name is used instead of the assembly name
                    using (Stream rscstr = typeof(Program).Assembly
                        .GetManifestResourceStream("Jellyfin.Server.Resources.Configuration.logging.json"))
                    using (Stream fstr = File.Open(configPath, FileMode.CreateNew))
                    {
                        await rscstr.CopyToAsync(fstr);
                    }
                }
                var configuration = new ConfigurationBuilder()
                    .SetBasePath(appPaths.ConfigurationDirectoryPath)
                    .AddJsonFile("logging.json")
                    .AddEnvironmentVariables("JELLYFIN_")
                    .Build();

                // Serilog.Log is used by SerilogLoggerFactory when no logger is specified
                Serilog.Log.Logger = new LoggerConfiguration()
                    .ReadFrom.Configuration(configuration)
                    .Enrich.FromLogContext()
                    .CreateLogger();
            }
            catch (Exception ex)
            {
                Serilog.Log.Logger = new LoggerConfiguration()
                    .WriteTo.Console(outputTemplate: "[{Timestamp:HH:mm:ss}] [{Level:u3}] {Message:lj}{NewLine}{Exception}")
                    .WriteTo.Async(x => x.File(
                        Path.Combine(appPaths.LogDirectoryPath, "log_.log"),
                        rollingInterval: RollingInterval.Day,
                        outputTemplate: "[{Timestamp:yyyy-MM-dd HH:mm:ss.fff zzz}] [{Level:u3}] {Message}{NewLine}{Exception}"))
                    .Enrich.FromLogContext()
                    .CreateLogger();

                Serilog.Log.Logger.Fatal(ex, "Failed to create/read logger configuration");
            }
        }

        public static IImageEncoder getImageEncoder(
            ILogger logger,
            IFileSystem fileSystem,
            StartupOptions startupOptions,
            Func<IHttpClient> httpClient,
            IApplicationPaths appPaths,
            IEnvironmentInfo environment,
            ILocalizationManager localizationManager)
        {
            try
            {
                return new SkiaEncoder(logger, appPaths, httpClient, fileSystem, localizationManager);
            }
            catch (Exception ex)
            {
                logger.LogInformation(ex, "Skia not available. Will fallback to NullIMageEncoder. {0}");
            }

            return new NullImageEncoder();
        }

        private static MediaBrowser.Model.System.OperatingSystem getOperatingSystem() {
            switch (Environment.OSVersion.Platform)
            {
                case PlatformID.MacOSX:
                    return MediaBrowser.Model.System.OperatingSystem.OSX;
                case PlatformID.Win32NT:
                    return MediaBrowser.Model.System.OperatingSystem.Windows;
                case PlatformID.Unix:
                default:
                {
                    string osDescription = RuntimeInformation.OSDescription;
                    if (osDescription.Contains("linux", StringComparison.OrdinalIgnoreCase))
                    {
                        return MediaBrowser.Model.System.OperatingSystem.Linux;
                    }
                    else if (osDescription.Contains("darwin", StringComparison.OrdinalIgnoreCase))
                    {
                        return MediaBrowser.Model.System.OperatingSystem.OSX;
                    }
                    else if (osDescription.Contains("bsd", StringComparison.OrdinalIgnoreCase))
                    {
                        return MediaBrowser.Model.System.OperatingSystem.BSD;
                    }
                    throw new Exception($"Can't resolve OS with description: '{osDescription}'");
                }
            }
        }

        public static void Shutdown()
        {
            if (!_tokenSource.IsCancellationRequested)
            {
                _tokenSource.Cancel();
            }
        }

        public static void Restart()
        {
            _restartOnShutdown = true;

            Shutdown();
        }

        private static void StartNewInstance(StartupOptions startupOptions)
        {
            _logger.LogInformation("Starting new instance");

            string module = startupOptions.GetOption("-restartpath");

            if (string.IsNullOrWhiteSpace(module))
            {
                module = Environment.GetCommandLineArgs().First();
            }

            string commandLineArgsString;

            if (startupOptions.ContainsOption("-restartargs"))
            {
                commandLineArgsString = startupOptions.GetOption("-restartargs") ?? string.Empty;
            }
            else
            {
                commandLineArgsString = string .Join(" ",
                    Environment.GetCommandLineArgs()
                        .Skip(1)
                        .Select(NormalizeCommandLineArgument)
                    );
            }

            _logger.LogInformation("Executable: {0}", module);
            _logger.LogInformation("Arguments: {0}", commandLineArgsString);

            Process.Start(module, commandLineArgsString);
        }

        private static string NormalizeCommandLineArgument(string arg)
        {
            if (!arg.Contains(" ", StringComparison.OrdinalIgnoreCase))
            {
                return arg;
            }

            return "\"" + arg + "\"";
        }
    }
}
