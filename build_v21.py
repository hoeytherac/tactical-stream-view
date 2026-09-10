import zipfile, os, shutil

build_dir = '_build_v21'
if os.path.exists(build_dir):
    shutil.rmtree(build_dir)
module_dir = os.path.join(build_dir, 'tactical-stream-view')
os.makedirs(module_dir, exist_ok=True)

# Copy module.json
shutil.copy('module.json', module_dir)
# Copy README if exists
if os.path.exists('README.md'):
    shutil.copy('README.md', module_dir)
if os.path.exists('CHANGELOG.md'):
    shutil.copy('CHANGELOG.md', module_dir)
if os.path.exists('LICENSE'):
    shutil.copy('LICENSE', module_dir)

# Copy directories
for d in ['scripts', 'styles', 'languages', 'templates', 'bridge']:
    src = d
    dst = os.path.join(module_dir, d)
    if os.path.isdir(src):
        if os.path.exists(dst):
            shutil.rmtree(dst)
        shutil.copytree(src, dst)

# Build ZIP
zip_name = 'tactical-stream-view-v1.1.0-alpha.21.zip'
if os.path.exists(zip_name):
    os.remove(zip_name)
with zipfile.ZipFile(zip_name, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(build_dir):
        for file in files:
            filepath = os.path.join(root, file)
            arcname = os.path.relpath(filepath, build_dir)
            z.write(filepath, arcname)

# Verify
with zipfile.ZipFile(zip_name) as z:
    names = z.namelist()
    print(f'ZIP contains {len(names)} files')
    for n in sorted(names):
        print(f'  {n}')
    assert any('tactical-stream-view/module.json' in n for n in names), 'Missing module.json in top-level folder'

# Cleanup
shutil.rmtree(build_dir)
print('ZIP built successfully')
