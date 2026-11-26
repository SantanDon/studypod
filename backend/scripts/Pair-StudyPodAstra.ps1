[CmdletBinding()]
param(
  [switch]$ShowDialog,
  [switch]$Verify,
  [switch]$SelfTest,
  [switch]$LibraryOnly,
  [string]$ReadPath,
  [string]$ApiBase = 'https://studypod-lm.vercel.app/api'
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
$Store = Join-Path $env:LOCALAPPDATA 'StudyPod\AgentConnections\Astra'
$CredentialPath = Join-Path $Store 'credential.clixml'
$MetadataPath = Join-Path $Store 'connection.json'
$StatusPath = Join-Path $Store 'pairing-status.json'
$Scopes = @('notebooks:read','sources:read','documents:read','notes:read','memories:read','tasks:read','missions:read','activity:read')

function Resolve-ApiBase([string]$Value) {
  $uri = [Uri]$Value
  if (-not $uri.IsAbsoluteUri -or $uri.UserInfo -or $uri.Query -or $uri.Fragment) { throw 'Enter an absolute StudyPod API URL without credentials, query or fragment.' }
  $local = $uri.Host -in @('localhost','127.0.0.1','[::1]','::1')
  if ($uri.Scheme -ne 'https' -and -not ($local -and $uri.Scheme -eq 'http')) { throw 'HTTPS is required, except for a loopback test server.' }
  if ($uri.AbsolutePath.TrimEnd('/') -ne '/api') { throw 'The API address must end in /api.' }
  return $uri.AbsoluteUri.TrimEnd('/')
}
function Initialize-PrivateStore {
  if (-not $env:LOCALAPPDATA) { throw 'A Windows user profile is required.' }
  [void][IO.Directory]::CreateDirectory($Store)
  if ((Get-Item -LiteralPath $Store).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'The credential directory cannot be a link.' }
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl = New-Object Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true, $false)
  $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
  $acl.AddAccessRule($rule)
  [IO.Directory]::SetAccessControl($Store, $acl)
}
function Write-Status([string]$State, [string]$Message) {
  @{state=$State;message=$Message;updatedAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $StatusPath -Encoding UTF8
}
function Invoke-AgentHttp([string]$Base, [string]$Path, [string]$Method='GET', $Body=$null, [string]$Key='') {
  $handler = New-Object Net.Http.HttpClientHandler
  $handler.AllowAutoRedirect = $false
  $client = New-Object Net.Http.HttpClient($handler)
  $client.Timeout = [TimeSpan]::FromSeconds(20)
  $request = New-Object Net.Http.HttpRequestMessage((New-Object Net.Http.HttpMethod($Method)), ($Base + $Path))
  if ($Key) { $request.Headers.Authorization = New-Object Net.Http.Headers.AuthenticationHeaderValue('Bearer', $Key) }
  if ($null -ne $Body) { $request.Content = New-Object Net.Http.StringContent(($Body | ConvertTo-Json -Depth 8 -Compress), [Text.Encoding]::UTF8, 'application/json') }
  try {
    $response = $client.SendAsync($request).GetAwaiter().GetResult()
    try {
      if (-not $response.IsSuccessStatusCode) { throw ('StudyPod returned HTTP ' + [int]$response.StatusCode + '. No redirect was followed. Check the server address, code expiry and granted access.') }
      $raw = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
      if ($raw.Length -gt 2000000) { throw 'Response exceeds the bounded inspection size.' }
      return ($raw | ConvertFrom-Json)
    } finally { $response.Dispose() }
  } finally { $request.Dispose(); $client.Dispose(); $handler.Dispose() }
}
function Load-Connection {
  if (-not (Test-Path -LiteralPath $CredentialPath) -or -not (Test-Path -LiteralPath $MetadataPath)) { throw 'Astra is not paired yet. Run this script with -ShowDialog.' }
  $metadata = Get-Content -LiteralPath $MetadataPath -Raw | ConvertFrom-Json
  $base = Resolve-ApiBase $metadata.apiBase
  if ($metadata.label -ne 'ChatGPT Astra Review' -or -not $metadata.expiresAt -or @($metadata.scopes).Count -eq 0 -or @($metadata.scopes | Where-Object { $_ -notin $Scopes }).Count -gt 0) { throw 'The saved grant does not meet the bounded read-only profile. Revoke it in Developer Tools and re-pair.' }
  $credential = Import-Clixml -LiteralPath $CredentialPath
  if ($credential -isnot [Management.Automation.PSCredential] -or $credential.UserName -ne $base) { throw 'Credential/server binding is invalid. Re-pair through the human approval flow.' }
  if ($metadata.expiresAt -and [DateTimeOffset]::Parse($metadata.expiresAt) -le [DateTimeOffset]::UtcNow) { throw 'Astra agent access has expired. Generate a fresh pairing code.' }
  $key = $credential.GetNetworkCredential().Password
  if ($key -notmatch '^spm_[a-fA-F0-9]{64}$') { throw 'The stored credential is not a StudyPod agent API key.' }
  return @{Metadata=$metadata;Base=$base;Key=$key}
}
function Complete-Pairing([string]$Base, [string]$Code) {
  $base = Resolve-ApiBase $Base
  if ($Code -notmatch '^\d{6}$') { throw 'Enter the fresh six-digit code from StudyPod Agent Pairing.' }
  if (Test-Path -LiteralPath $CredentialPath) { throw 'An Astra credential already exists. Verify or revoke the prior grant before replacing it; no duplicate key was requested.' }
  $result = Invoke-AgentHttp -Base $base -Path '/auth/pair/complete' -Method 'POST' -Body @{code=$Code;label='ChatGPT Astra Review';scopes=$Scopes;expiresInHours=24;rateLimit=60}
  $Code = $null
  if ($result.key -notmatch '^spm_[a-fA-F0-9]{64}$') { throw 'Pairing returned an unexpected credential; no key was printed.' }
  # Export-Clixml encrypts SecureString with Windows DPAPI for this user/machine.
  $secureKey = ConvertTo-SecureString -String $result.key -AsPlainText -Force
  $credential = New-Object Management.Automation.PSCredential($base, $secureKey)
  $credential | Export-Clixml -LiteralPath $CredentialPath -Encoding UTF8
  $metadata = @{apiBase=$base;label=$result.label;keyId=$result.id;scopes=@($result.scopes);notebookIds=$result.notebookIds;expiresAt=$result.expiresAt;createdAt=[DateTime]::UtcNow.ToString('o');credentialStorage='Windows DPAPI / current user'}
  $metadata | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $MetadataPath -Encoding UTF8
  $extra = @($result.scopes | Where-Object { $_ -notin $Scopes })
  if ($extra.Count -gt 0) { Write-Status 'review_required' 'The server granted unexpected scopes. Do not use this key; revoke it in Developer Tools.'; throw 'Unexpected access scopes. The saved grant needs review and must not be used.' }
  $me = Invoke-AgentHttp -Base $base -Path '/auth/me' -Key $result.key
  $result.key = $null
  Write-Status 'paired_verified' ('Paired as ChatGPT Astra Review for ' + $me.displayName + '; read-only access expires in 24 hours.')
  return $me.displayName
}

if ($LibraryOnly) { return }
Initialize-PrivateStore
if ($SelfTest) {
  $probe = Join-Path $Store ('selftest-' + [Guid]::NewGuid().ToString('N') + '.clixml')
  $value = 'synthetic-fixture-' + [Guid]::NewGuid().ToString('N')
  try {
    $secure = ConvertTo-SecureString $value -AsPlainText -Force
    (New-Object Management.Automation.PSCredential('synthetic-test-only', $secure)) | Export-Clixml -LiteralPath $probe
    if ((Import-Clixml -LiteralPath $probe).GetNetworkCredential().Password -ne $value) { throw 'DPAPI round trip failed' }
    foreach ($bad in @('http://example.com/api','https://example.com/api?token=x','https://user:pass@example.com/api','https://example.com/not-api')) {
      $rejected=$false; try { [void](Resolve-ApiBase $bad) } catch { $rejected=$true }; if (-not $rejected) { throw 'Unsafe endpoint accepted' }
    }
    [void](Resolve-ApiBase 'https://studypod-lm.vercel.app/api')
    [void](Resolve-ApiBase 'http://127.0.0.1:4000/api')
    Write-Output 'PASS: encrypted local credential round trip; restricted directory; endpoint and redirect safeguards. No real account or pairing request used.'
  } finally { Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue }
  exit 0
}
if ($Verify -or $ReadPath) {
  $connection = Load-Connection
  try {
    if ($ReadPath) {
      if ($ReadPath -notmatch '^/(notebooks(?:/[A-Za-z0-9_-]+/context)?|sources/[A-Za-z0-9_-]+|audiobook/health)$') { throw 'This inspection command permits only allowlisted read-only API paths.' }
      Invoke-AgentHttp -Base $connection.Base -Path $ReadPath -Key $connection.Key | ConvertTo-Json -Depth 14
    } else {
      $me = Invoke-AgentHttp -Base $connection.Base -Path '/auth/me' -Key $connection.Key
      @{verified=$true;displayName=$me.displayName;agentLabel=$connection.Metadata.label;scopes=$connection.Metadata.scopes;expiresAt=$connection.Metadata.expiresAt;apiBase=$connection.Base} | ConvertTo-Json -Depth 5
    }
  } finally { $connection.Key=$null }
  exit 0
}
if (-not $ShowDialog) { throw 'Use -ShowDialog to pair, -Verify to check access, or -SelfTest for offline safeguards.' }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form=New-Object Windows.Forms.Form
$form.Text='Pair StudyPod with Astra'; $form.Width=570; $form.Height=340; $form.StartPosition='CenterScreen'; $form.FormBorderStyle='FixedDialog'; $form.MaximizeBox=$false
$instructions=New-Object Windows.Forms.Label
$instructions.Text="In StudyPod, click Generate Pairing Code, then enter it below.`nThis grants Astra read-only access for 24 hours. The encrypted key stays`non this Windows account, outside Dropbox. No password or API key goes to chat."
$instructions.SetBounds(20,15,515,62); $form.Controls.Add($instructions)
$urlLabel=New-Object Windows.Forms.Label; $urlLabel.Text='StudyPod API address (confirm the site you are using)'; $urlLabel.SetBounds(20,85,500,20); $form.Controls.Add($urlLabel)
$urlBox=New-Object Windows.Forms.TextBox; $urlBox.Text=$ApiBase; $urlBox.SetBounds(20,109,515,25); $form.Controls.Add($urlBox)
$pinLabel=New-Object Windows.Forms.Label; $pinLabel.Text='Fresh six-digit pairing code'; $pinLabel.SetBounds(20,147,300,20); $form.Controls.Add($pinLabel)
$pinBox=New-Object Windows.Forms.TextBox; $pinBox.UseSystemPasswordChar=$true; $pinBox.MaxLength=6; $pinBox.SetBounds(20,171,165,27); $form.Controls.Add($pinBox)
$status=New-Object Windows.Forms.Label; $status.SetBounds(20,242,515,48); $form.Controls.Add($status)
$pairButton=New-Object Windows.Forms.Button; $pairButton.Text='Pair read-only agent'; $pairButton.SetBounds(205,169,185,32); $form.Controls.Add($pairButton)
$cancelButton=New-Object Windows.Forms.Button; $cancelButton.Text='Cancel'; $cancelButton.SetBounds(405,169,125,32); $form.Controls.Add($cancelButton)
$cancelButton.Add_Click({ Write-Status 'cancelled' 'Pairing cancelled by the user. No agent access assumed.'; $form.Close() })
$pairButton.Add_Click({
  $pairButton.Enabled=$false
  try { $name=Complete-Pairing $urlBox.Text $pinBox.Text; $pinBox.Clear(); $status.Text='Verified read-only connection for '+$name; $timer.Stop(); $form.Close() }
  catch { $pinBox.Clear(); $status.Text=$_.Exception.Message; Write-Status 'action_required' 'Pairing did not complete. Check the local prompt; no secret was logged.'; $pairButton.Enabled=$true }
})
$timer=New-Object Windows.Forms.Timer; $timer.Interval=300000
$timer.Add_Tick({ $timer.Stop(); Write-Status 'awaiting_user' 'The local pairing prompt timed out without a verified connection. Reopen it with a fresh code.'; $form.Close() })
$form.Add_Shown({$pinBox.Focus()})
Write-Status 'awaiting_user' 'Local pairing prompt is open; user must generate and enter a fresh code.'
$timer.Start()
try { [void]$form.ShowDialog() } finally { $timer.Dispose(); $form.Dispose() }
