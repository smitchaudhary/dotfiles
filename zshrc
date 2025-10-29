# Enable Powerlevel10k instant prompt. Should stay close to the top of ~/.zshrc.
# Initialization code that may require console input (password prompts, [y/n]
# confirmations, etc.) must go above this block; everything else may go below.
if [[ -r "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh" ]]; then
  source "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh"
fi

# For profiling zsh. No need to load it. I keep it around for when I want to profile and
# then comment it out when I am done.
# zmodload zsh/zprof

#For homebrew to work
eval $(/opt/homebrew/bin/brew shellenv)

export CLICOLOR=1
export LSCOLORS=GxFxCxDxBxegedabagaced

alias ls='ls -GFh'
alias cls='clear'
alias rm='gomi'

# Useful support for interacting with Terminal.app or other terminal programs
[ -r "/etc/zshrc_$TERM_PROGRAM" ] && . "/etc/zshrc_$TERM_PROGRAM"

# History related settings
HISTFILE=$HOME/.zsh_history
HISTSIZE=50000
SAVEHIST=$HISTSIZE

setopt INC_APPEND_HISTORY     # Immediately append to history file.
setopt EXTENDED_HISTORY       # Record timestamp in history.
setopt HIST_EXPIRE_DUPS_FIRST # Expire duplicate entries first when trimming history.
setopt HIST_IGNORE_DUPS       # Do not record an entry that was just recorded again.
setopt HIST_IGNORE_ALL_DUPS   # Delete old recorded entry if new entry is a duplicate.
setopt HIST_FIND_NO_DUPS      # Do not display a duplicate entry.
setopt HIST_IGNORE_SPACE      # Do not record commands starting with a space.
setopt HIST_SAVE_NO_DUPS      # Remove duplicates in the history file.
setopt SHARE_HISTORY          # Share history between all sessions.

# Set up fzf key bindings and fuzzy completion
source <(fzf --zsh)

# For Mojo
export MODULAR_HOME="$HOME/.modular"
export PATH="$MODULAR_HOME/pkg/packages.modular.com_mojo/bin:$PATH"


# Add RVM to PATH for scripting. Make sure this is the last PATH variable change.
#export PATH="$PATH:$HOME/.rvm/bin"
#export PATH="$HOME/.rbenv/bin:$PATH"

# Enable vim mode for command line editing
bindkey -v

# Reduce delay for key combinations to change to vi mode faster
export KEYTIMEOUT=1

# Open line in vim by pressing 'v' in command mode
autoload -U edit-command-line
zle -N edit-command-line
bindkey -M vicmd v edit-command-line

# Load private credentials and such that should not be shared with the dotfile
# Currently loads API Keys
local private="${HOME}/.zsh.d/private.sh"
if [ -e ${private} ]; then
  . ${private}
fi

# Overrides the cd command to activate the virtualenv if it is found in the folder
# and deactivate if the folder is changed to an external folder. The virtual env
# folder should be named .venv. This is useful when I am working on multiple projects
# and I don't want to activate the virtualenv every time I cd into the folder.
# But now that I use hatch, I don't need this anymore. Useful to keep it around.
# function cd() {
#   builtin cd "$@"

#   if [[ -z "$VIRTUAL_ENV" ]] ; then
#     ## If env folder is found then activate the vitualenv
#       if [[ -d ./.venv ]] ; then
#         source ./.venv/bin/activate
#       fi
#   else
#     ## check the current folder belong to earlier VIRTUAL_ENV folder
#     # if yes then do nothing
#     # else deactivate
#       parentdir="$(dirname "$VIRTUAL_ENV")"
#       if [[ "$PWD"/ != "$parentdir"/* ]] ; then
#         deactivate
#       fi
#   fi
# }

alias gs="git status"
alias ga="git add"
alias gap="git add --patch"
alias gco="git checkout"
alias gl1="git log --oneline"
alias gcm="git commit -m"
alias gm="git merge"
alias glg="git log"
alias gd="git diff"
alias gb="git branch"
alias gch="git branch -l | fzf | xargs -I ZZZ git checkout ZZZ"
alias gchr="git branch -r | fzf | xargs -I ZZZ git checkout --track ZZZ"
alias tls="tmux list-session"
alias hvs="hatch -v shell"

alias js="jj status"
alias jcm="jj commit -m"
alias jdm="jj describe -m"
alias jd="jj diff"
alias jn="jj new"

# Load zsh-async for jj prompt support
# Add zsh-async to FPATH and autoload it
fpath+=/opt/homebrew/opt/zsh-async/share/zsh/site-functions
autoload -Uz async && async

# To customize prompt, run `p10k configure` or edit ~/.p10k.zsh.
[[ ! -f ~/.p10k.zsh ]] || source ~/.p10k.zsh
source /opt/homebrew/share/powerlevel10k/powerlevel10k.zsh-theme

# This is to enable syntax highlighting for zsh
source /opt/homebrew/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh

export PYENV_ROOT="$HOME/.pyenv"
[[ -d $PYENV_ROOT/bin ]] && export PATH="$PYENV_ROOT/bin:$PATH"
eval "$(pyenv init -)"

. "$HOME/.local/bin/env"

# opencode
export PATH=/Users/smit/.opencode/bin:$PATH

eval "$(zoxide init zsh)"

# zprof # To profile
