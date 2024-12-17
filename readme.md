### lurker

This is a fork of https://github.com/oppiliappan/lurker/ and I respect their work! It adds `SSO` via Remote Header Authorization.

lurker is a selfhostable, read-only reddit client. it is
better than old-reddit because:

- it renders well on mobile
- it respects `prefers-color-scheme`
- no account necessary to subscribe to subreddits
- no account necessary for over-18 content

i host a version for myself and a few friends. reach out to
me if you would like an invite. 

### features

- minimal use of client-side javascript
- account-based subscription system
- pagination
- invite-only user management
- comment collapsing, jump-to-next/prev comment
- "search on undelete" url for deleted comments
- over-18, spoiler images are hidden by default

i use lurker daily, and above features are pretty good for
my use. i do not intend to add much more, i don't like
writing js.

### gallery

| ![login](./img/login.png) | ![search](./img/search.png)      | ![subreddit](./img/subreddit.png) |
| ------------------------- | -------------------------------- | --------------------------------- |
| login                     | search                           | subreddit view                    |

| ![subs](./img/subs.png)   | ![gallery](./img/gallery.png)    | ![comments](./img/comments.png)   |
| ------------------------- | -------------------------------- | --------------------------------- |
| subscriptions page        | inline post thumbnail expand     | comments view                     |

| ![collapse](./img/collapse.png) | ![invite](./img/invite.png)      | ![light](./img/light.png)  | ![mobile](./img/mobile.png) |
| ------------------------------- | -------------------------------- | -------------------------- | --------------------------- |
| collapse comments               | admin dashboard & invites table  | light mode                 | mobile optimized page       |

### setup

you can run lurker as a systemd service on nixos:

```nix
inputs.lurker.url= "git+https://git.peppe.rs/web/lurker";
  .
  .
  .
services.lurker = {
  enable = true;
  port = 9495;
};
```

or with the docker image:

```bash
# pull the latest image from gh container registry
$ docker pull ghcr.io/oppiliappan/lurker:latest

# the image will be marked as created on 1970, this is a
# quirk of using nix, it should not affect usage
$ docker image ls
REPOSITORY                   TAG       IMAGE ID       CREATED        SIZE
ghcr.io/oppiliappan/lurker   latest    ba3733164889   54 years ago   186MB

# start lurker in a container
#
# lurker stores data in /data,
# so create a volume on the host accordingly:
$ docker run -v /your/host/lurker-data:/data ghcr.io/oppiliappan/lurker:latest
```

or with just [bun](https://bun.sh/):

```bash
bun run src/index.js 
```

### usage

the instance is open to registrations when first started.
you can head to /register and create an account. this
account will be an admin account. you can click on your
username at the top-right to view the dashboard and to
invite other users to your instance. copy the link and send
it to your friends!

### technical

lurker uses an sqlite db to store accounts, invites and
subscriptions. it creates `lurker.db` in the current
directory. there is no way to configure this right now.

to hack on lurker:

```bash
nix shell .#        # get a devshell
nix build .#lurker  # build the thing
```

### todo

- [ ] avoid js to toggle details in views/index.pug
- [ ] highlights for op, sticky etc.
- [ ] open in reddit/reply in reddit link
- [ ] subscription manager: reorder, mass add
- [ ] support crossposts
- [x] collapse even singular comments
- [x] details tag on safari
- [x] expand/collapse comments
- [x] fix gallery thumbnails
- [x] fix spacing between comments
- [x] fix title rendering in views/comments.pug
- [x] pass query params into templates, add into pagination
- [x] placeholder for unresolvable thumbnails
- [x] set home to sum of subs
- [x] styles for info-containers
- [x] support 'more comments'
