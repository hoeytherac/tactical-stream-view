import zipfile, os, shutil

build_dir = '_build_v17'
if os.path.exists(build_dir):
    shutil.rmtree(build_dir)
os.makedirs(build_dir, exist_ok=True)

files_to_copy = ['module.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'stream.html']
for d in ['scripts', 'styles', 'languages', 'templates', 'bridge']:
    src = d
    if os.path.isdir(src):
        dst = os.path.join(build_dir, d)
        if os.path.exists(dst):
            shutil.rmtree(dst)
        shutil.copytree(src, dst)
for f in files_to_copy:
    if os.path.exists(f):
        shutil.copy(f, build_dir)

with zipfile.ZipFile('tactical-stream-view-v1.1.0-alpha.17.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(build_dir):
        for file in files:
            filepath = os.path.join(root, file)
            arcname = os.path.relpath(filepath, build_dir)
            z.write(filepath, arcname)

shutil.rmtree(build_dir)
print('Done')
